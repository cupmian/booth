// const forcedScheduledTime = Date.now() + 30000
const forcedScheduledTime = null
const interceptor = {
  emptyCartAfterModify: false,
  needSignIn: false,
  returnBeforeCheckout: false,
  emptyOrderId: false,
}

const idFormat = /^\d+$/

const defaultOptions = {
  payment: 'econtext',
  shipping: 'box',
  name: 'ZHANG',
  zip: '5800014',
  prefecture: '大阪府',
  address1: '松原市岡---',
  address2: 'TSK (-----)',
  phone: '07200000000',
  nameEc1: 'XING',
  nameEc2: 'MING',
  phoneEc: '07200000000',
  retryCount: 5,
  burstTimeout: 5,
  isDryRun: false,
}

let csrf

const updateCsrf = async () => {
  const response = await fetchWithRetry('https://booth.pm/company', { credentials: 'include' })
  const data = await response.text()
  csrf = data.match(/<meta name="csrf-token" content="([^"]*)/)?.[1]
}

const debugObj = {}

const debug = (label, data) => {
  debugObj[`${new Date().toISOString()} ${label}`] = data
}

const getOptions = () => new Promise((res) => {
  chrome.storage.local.get('options', ({ options = {} }) => res(options))
})

const notify = (title, message) => {
  debug(title, message)
  return chrome.notifications.create({
    title,
    message,
    type: 'basic',
    iconUrl: chrome.runtime.getURL('images/icon.128.png'),
  })
}

const fetchWithRetry = async (input, init) => {
  const { retryCount } = await getOptions()
  let i = 0
  let response
  while (i < retryCount) {
    try {
      response = await fetch(input, init)
      if (response.ok) {
        return response
      }
      if (response.status >= 400 && response.status < 500) {
        break
      }
    } finally {
      i += 1
    }
  }
  if (i === retryCount) {
    notify('网络请求超过重试次数', '')
  }
  throw new Error(`Connection Failed.\nStatus Code: ${response.status}`)
}

const retry = async (proc) => {
  const { retryCount } = await getOptions()
  let i = 0

  const retryable = () => proc().catch((err) => {
    i += 1
    if (i === retryCount) {
      notify('超过重试次数', '')
      throw err
    }
    return retryable()
  })
  return retryable()
}

const mapCompactKey = (obj, callback) => Object.fromEntries(
  Object.entries(obj).map(([k, v]) => [callback(k, v, obj), v]).filter(([k]) => k),
)

const mapCompactValueAsync = (obj, callback) => Promise.all(
  Object.entries(obj).map(async ([k, v]) => [k, await callback(v, k, obj)]),
).then(entries => entries.filter(([, v]) => v)).then(Object.fromEntries)

const runTask = async (task, quiet) => {
  const {
    options: { payment, shipping, name, zip, prefecture, address1, address2, phone, nameEc1, nameEc2, phoneEc },
    productBrand, products,
  } = task
  const { isDryRun } = await getOptions()

  const resolvedProducts = await mapCompactValueAsync(
    products,
    (variants, productId) => Object.keys(variants).every(variant => variant.match(idFormat)) ? variants : fetchWithRetry(
      `https://booth.pm/en/items/${productId}`, { credentials: 'include' },
    ).then(
      response => response.text(),
    ).then((data) => mapCompactKey(
      variants,
      (variant) => variant.match(idFormat) ? variant : data.match(/data-product-variant="(\d+)/)?.[1]),
    ),
  )

  const quantityByVariationEntries = Object.values(resolvedProducts).map((variants) => Object.entries(variants)).flat()
  const quantityByVariation = Object.fromEntries(quantityByVariationEntries)

  const modifyCart = async () => {
    let uuid = ''
    let cartItems = []
    let response, data
    for (const variation of Object.keys(quantityByVariation)) {
      try {
        const quantity = quantityByVariation[variation]
        if (cartItems.find(({ variation: { id } }) => String(id) === variation)?.quantity === quantity) {
          continue
        }
        response = await fetchWithRetry(`https://${productBrand}.booth.pm/cart.json`, {
          method: 'POST',
          body: new URLSearchParams({
            '_method': 'patch',
            'cart_item[variation_id]': variation,
            'cart_item[quantity]': String(quantity),
            'cart_item[boost]': '0',
          }),
          headers: { 'X-CSRF-Token': csrf },
          credentials: 'include',
        })
        data = await response.json()
        uuid = data['carts'][0]['shop']['checkout_url'].match(/uuid=(.*)/)[1]
        cartItems = data['carts'][0]['cart_items']
        debug('cartItems after modify cart', cartItems)
      } catch {
        !quiet && notify('加购失败', `卖家：${productBrand}\n可能是商品${variation}缺货，正在尝试其他商品`)
      }
    }

    if (!cartItems.length || interceptor.emptyCartAfterModify) {
      throw new Error('没有可结算商品')
    }

    for (const { variation: { id } } of cartItems) {
      try {
        if (quantityByVariation[String(id)]) {
          continue
        }
        response = await fetchWithRetry(`https://${productBrand}.booth.pm/cart.json`, {
          method: 'POST',
          body: new URLSearchParams({
            '_method': 'patch',
            'cart_item[variation_id]': String(id),
            'cart_item[quantity]': '0',
            'cart_item[boost]': '0',
          }),
          headers: { 'X-CSRF-Token': csrf },
          credentials: 'include',
        })
        data = await response.json()
        uuid = data['carts'][0]['shop']['checkout_url'].match(/uuid=(.*)/)[1]
      } catch {
        !quiet && notify('清理失败', `卖家：${productBrand}\n无关商品${id}将加入结算`)
      }
    }

    return uuid
  }

  const checkout = async (uuid) => {
    // Step 3
    const response = await fetchWithRetry('https://checkout.booth.pm/checkout/step3', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
      },
      body: new URLSearchParams({
        'utf8': '✓',
        'authenticity_token': csrf,
        'uuid': uuid,
        'order[warehouse_shipping_method]': shipping,
        'order[payment_type]': payment,
        'econtext[last_name]': nameEc1,
        'econtext[first_name]': nameEc2,
        'econtext[phone_number]': phoneEc,
        'shipping_address[name]': name,
        'shipping_address[zip_code]': zip,
        'shipping_address[prefecture]': prefecture,
        'shipping_address[address1]': address1,
        'shipping_address[address2]': address2,
        'shipping_address[phone_number]': phone,
        'order[save_address]': '0',
        'button': '',
      }),
      credentials: 'include',
    })

    if (response.url.match(/sign_in/) || interceptor.needSignIn) {
      // Need login. Task failed.
      notify('需要登录', `登录状态异常`)
      return chrome.tabs.create({ url: response.url })
    }

    const data = await response.text()
    const total = data.match(/id="total_price"\s+value="(\d+)"/)?.[1]

    debug('response.text() after step3', data)
    debug('total after step3', total)

    if (isDryRun || interceptor.returnBeforeCheckout) {
      return notify('测试成功', `卖家：${productBrand}\n合计：${total}日元`)
    }

    // Create
    const urlSearchParams = new URLSearchParams({
      'utf8': '✓',
      'authenticity_token': csrf,
      'uuid': uuid,
      'order[warehouse_shipping_method]': shipping,
      'order[payment_type]': payment,
      'econtext[last_name]': nameEc1,
      'econtext[first_name]': nameEc2,
      'econtext[phone_number]': phoneEc,
      'shipping_address[name]': name,
      'shipping_address[zip_code]': zip,
      'shipping_address[prefecture]': prefecture,
      'shipping_address[address1]': address1,
      'shipping_address[address2]': address2,
      'shipping_address[phone_number]': phone,
      'order[save_address]': '0',
      'total_price': String(total),
      'commit': 'ご注文確定',
      action: 'https://checkout.booth.pm/checkout/create',
    })

    debug('urlSearchParams has been prepared', urlSearchParams)

    if (interceptor.emptyOrderId) {
      throw new Error('orderId is empty')
    }

    return fetchWithRetry('https://checkout.booth.pm/checkout/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
      },
      body: urlSearchParams,
      credentials: 'include',
      mode: 'cors',
    }).then(async (response) => {
      debug('response.text() after create', await response.text())
      debug('response.url after create', response.url)
      const orderId = response.url.match(/https:\/\/checkout.booth.pm\/orders\/(\d+)/)?.[1]
      if (orderId) {
        notify('下单成功', `卖家：${productBrand}\n合计：${total}日元`)
        return chrome.tabs.create({ url: `https://accounts.booth.pm/orders/${orderId}` })
      }
      throw new Error('orderId is empty')
    })
  }
  const uuid = await retry(modifyCart)
  return retry(() => checkout(uuid))
}

const tasks = {}

const addTask = ({ options, productBrand, scheduledTime }) => {
  const key = JSON.stringify({ options, productBrand, scheduledTime })
  tasks[key] ||= { options, productBrand, scheduledTime, products: {} }
  return key
}

const addVariant = ({ options, productBrand, scheduledTime, productId, variants }) => {
  const key = addTask({ options, productBrand, scheduledTime })
  tasks[key].products[productId] = { ...tasks[key].products[productId], ...variants }
}

const addQuantity = ({ options, productBrand, scheduledTime, productId, productVariant, quantity }) => {
  const key = addTask({ options, productBrand, scheduledTime })
  tasks[key].products[productId] ||= {}
  tasks[key].products[productId][productVariant] ||= 0
  tasks[key].products[productId][productVariant] += quantity
}

const removeProduct = ({ options, productBrand, scheduledTime, productId }) => {
  const key = JSON.stringify({ options, productBrand, scheduledTime })
  delete tasks[key].products[productId]
  if (Object.keys(tasks[key].products).length === 0) {
    delete tasks[key]
  }
}

const runAvailableTasks = async () => {
  const taskEntriesToRun = Object.entries(tasks).filter(([, { scheduledTime }]) => scheduledTime <= Date.now())
  for (const [key, task] of taskEntriesToRun) {
    delete tasks[key]
    await runTask(task)
  }
}

const getScheduledTime = (productId) => fetchWithRetry(
  `https://booth.pm/en/items/${productId}`, { credentials: 'include' },
).then(
  response => response.text(),
).then(
  text => {
    const matched = text.match(/From (.*?) JST/)
    return matched ? new Date(`${matched[1]}+09:00`) : new Date()
  },
).then(
  date => new Date() > date ? null : Number(date),
).then(
  scheduledTime => forcedScheduledTime || scheduledTime,
)

const updateScheduledTasks = async () => {
  for (const [, { products, scheduledTime, ...task }] of Object.entries(tasks)) {
    for (const [productId, variants] of Object.entries(products)) {
      const newScheduledTime = await getScheduledTime(productId)
      if (newScheduledTime && (forcedScheduledTime && Date.now() < forcedScheduledTime)) {
        removeProduct({ ...task, scheduledTime, productId })
        addVariant({ ...task, scheduledTime: newScheduledTime, productId, variants })
        chrome.alarms.clear(`task_schedule_${newScheduledTime}`, () => {
          chrome.alarms.create(`task_schedule_${newScheduledTime}`, { when: newScheduledTime })
        })
      }
    }
  }
  console.log('updated tasks', tasks)
}

chrome.runtime.onInstalled.addListener(() => getOptions().then(
  (options) => chrome.storage.local.set({ options: { ...defaultOptions, ...options } }),
))

chrome.runtime.onMessage.addListener((
  { action, data }, _sender, sendResponse,
) => {
  if (action === 'notify') {
    const { title, message } = data
    return notify(title, message)
  }
  if (action === 'openOptionsPage') {
    return chrome.runtime.openOptionsPage()
  }
  if (action === 'getTasks') {
    return sendResponse(JSON.stringify(tasks))
  }
  if (action === 'deleteTask') {
    delete tasks[data]
    // Alarm is not cleared
    return sendResponse()
  }
  if (action === 'getOptions') {
    getOptions().then(sendResponse)
  }
  if (action === 'burstOrder') {
    const { productBrand, productId, productVariant, quantity } = data
    getOptions().then(async (
      { payment, shipping, name, zip, prefecture, address1, address2, phone, nameEc1, nameEc2, phoneEc },
    ) => {
      try {
        await runTask({
          options: { payment, shipping, name, zip, prefecture, address1, address2, phone, nameEc1, nameEc2, phoneEc },
          productBrand, products: { [productId]: { [productVariant]: quantity } },
        }, true)
        sendResponse(true)
      } catch {
        sendResponse(false)
      }
    })
  }
  if (action === 'addOrder') {
    const { productBrand, productId, productVariant, quantity } = data
    getOptions().then(async (
      { payment, shipping, name, zip, prefecture, address1, address2, phone, nameEc1, nameEc2, phoneEc },
    ) => {
      try {
        const scheduledTime = productVariant.match(idFormat) ? forcedScheduledTime : await getScheduledTime(productId)

        addQuantity({
          options: { payment, shipping, name, zip, prefecture, address1, address2, phone, nameEc1, nameEc2, phoneEc },
          productBrand, scheduledTime, productId, productVariant, quantity,
        })

        if (scheduledTime) {
          chrome.alarms.clear(`task_schedule_${scheduledTime}`, () => {
            chrome.alarms.create(`task_schedule_${scheduledTime}`, { when: scheduledTime })
            sendResponse('OK: 已预约订单')
          })
        } else {
          await runAvailableTasks()
          sendResponse('OK: 已下单')
        }
      } catch (err) {
        console.error(err)
        notify('下单失败', err.message)
        sendResponse('Error: ' + err.message)
      }
    })
  }

  return true
})

chrome.alarms.onAlarm.addListener(async ({ name }) => {
  if (name.startsWith('task_schedule')) {
    await runAvailableTasks().catch((err) => {
      console.error(err)
      notify('预约下单失败', err.message)
    })
  }
  if (name.startsWith('task_update')) {
    await updateScheduledTasks().catch(console.error)
  }
  if (name.startsWith('csrf_update')) {
    await updateCsrf().catch(console.error)
  }
})

chrome.alarms.create('task_update', { periodInMinutes: 1 })
chrome.alarms.create('csrf_update', { periodInMinutes: 2 })
updateCsrf().catch(console.error)
