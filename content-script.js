const idFormat = /^\d+$/

const idByVariant = {}

const generateId = (() => {
  let id = 0
  return () => {
    id += 1
    return id
  }
})()

const getOptions = () => new Promise(resolve => {
  chrome.runtime.sendMessage({ action: 'getOptions' }, resolve)
})

const notify = (title, message) => chrome.runtime.sendMessage({ action: 'notify', data: { title, message } })

const insertBefore = (newChild, refChild) => refChild.parentNode.insertBefore(newChild, refChild)

const createQuantityTaskType = (productVariant) => {
  const id = idByVariant[productVariant]
  const div = document.createElement('div')
  div.className = 'u-my-200 u-d-flex'
  div.style.alignItems = 'center'
  div.style.justifyContent = 'space-between'
  div.innerHTML = `
  <label class="cart-item__label">
    <span>個数</span>
    <input max="99" min="1" type="number" id="quantity_${id}" value="1"
           class="cart-item__input cart-item__input--quantity u-h-100">
  </label>
  ${productVariant.match(idFormat) ? `
  <div class="booth-select-wrap u-w-100">
    <select class="booth-select" id="taskType_${id}">
      <option value="add">今すぐ注文する</option>
      <option value="burst">バースト・リンク</option>
    </select>
  </div>` : `
  <input id="taskType_${id}" value="add" hidden>`}`
  return div
}

const createButton = (productBrand, productId, productVariant) => {
  const id = idByVariant[productVariant]
  const btn = document.createElement('button')
  btn.className = 'btn add-cart-negative full-length'
  btn.type = 'button'
  btn.innerText = 'Fxck booth.pm'
  btn.style.marginLeft = '0'
  btn.addEventListener('click', async (event) => {
    event.stopImmediatePropagation()
    const quantity = Number(document.querySelector(`#quantity_${id}`).value)
    const taskType = document.querySelector(`#taskType_${id}`).value
    btn.innerText = 'Fxcking...Please wait'
    btn.disabled = true
    if (taskType === 'add') {
      chrome.runtime.sendMessage(
        {
          action: `${taskType}Order`,
          data: { productBrand, productId, productVariant, quantity },
        },
        (message) => {
          btn.disabled = false
          btn.innerText = message
        },
      )
    } else {
      let timeout = false
      let count = 0
      const { burstTimeout } = await getOptions()
      setTimeout(() => {
        timeout = true
      }, burstTimeout * 60 * 60 * 1000)
      const callback = (message) => {
        if (!timeout && message === false) {
          btn.innerText = `Burst Link...${count += 1}!!!`
          return chrome.runtime.sendMessage(
            {
              action: `${taskType}Order`,
              data: { productBrand, productId, productVariant, quantity },
            },
            callback,
          )
        }

        btn.disabled = false
        if (message === true) {
          btn.innerText = 'OK: 捡漏成功'
          notify('捡漏成功', '下次还来')
        } else if (timeout) {
          btn.innerText = 'Error: Burst时长耗尽'
          notify('下单失败', 'Burst时长耗尽')
        } else {
          btn.innerText = `Error: ${message}`
          notify('下单失败', message)
        }
      }
      callback(false)
    }
  })
  return btn
}

const createLabel = (productVariant) => {
  const div = document.createElement('div')
  div.innerText = productVariant
  div.className = 'u-tpg-caption1 u-text-gray-300'
  return div
}

const createEntries = (productBrand, productId) => {
  [
    [...document.querySelectorAll('a.remove-request')].map((element) => [element, element.dataset.url.match(/\/variations\/(\d+)\/restock_request/)?.[1]]),
    [...document.querySelectorAll('form.button_to button')].map((element) => [element, element.dataset.productVariant]),
    [...document.querySelectorAll('.variation-cart button.disabled .cmd-label')].map((element) => [element.closest('.variation-item').querySelector('button'), element.closest('.variation-item').querySelector('.variation-name').innerText]),
  ].flat().map(([refElement, productVariant]) => {
    idByVariant[productVariant] = generateId()
    if (!refElement) {
      console.log(productVariant)
    }
    insertBefore(createQuantityTaskType(productVariant), refElement.parentNode)
    refElement.parentNode.appendChild(createButton(productBrand, productId, productVariant))
    refElement.parentNode.appendChild(createLabel(productVariant))
  })
}

[
  [/^https:\/\/(?:booth.pm\/.*?|.*?.booth.pm)\/items\/(\d+)/, '[data-ga-tracking-id][data-product-brand]', 'productBrand'],
].forEach(([matcher, selector, path]) => {
  const matched = location.href.match(matcher)
  if (matched) {
    const element = document.querySelector(selector)
    element && createEntries(element.dataset[path], matched[1])
  }
})

const downloadAddresses = () => {
  chrome.storage.local.get('options', (result) => {
    const { options = {} } = result
    Object.entries(options).map(([k, v]) => {
      const input = document.querySelector(`#${k}`)
      input && (input.innerText = v)
    })
  })
}

const createAddress = () => {
  const div = document.createElement('div')
  div.innerHTML = `
  <div class="u-mb-500 u-px-600" style="border-bottom: 1px solid #F3F3F3;">
    <div style="font-weight: 600;font-size: 1.2em;text-align: center;">お届け先</div>
    <div>
      <label class="u-tpg-label">
        <span class="u-align-middle">氏名</span>
      </label>
      <div id="name"></div>
    </div>
    <div class="u-mt-100">
      <label class="u-tpg-label">
        <span class="u-align-middle">郵便番号</span>
      </label>
      <div id="zip"></div>
    </div>
    <div class="u-mt-100">
      <label class="u-tpg-label">
        <span class="u-align-middle">都道府県</span>
      </label>
      <div id="prefecture"></div>
    </div>
    <div class="u-mt-100">
      <label class="u-tpg-label">
        <span class="u-align-middle">市区町村・丁目・番地</span>
      </label>
      <div id="address1"></div>
    </div>
    <div class="u-mt-100">
      <label class="u-tpg-label">マンション・建物名・部屋番号</label>
      <div id="address2"></div>
    </div>
    <div class="u-mt-100">
      <label class="u-tpg-label">
        <span class="u-align-middle">電話番号</span>
      </label>
      <div id="phone"></div>
    </div>
    <div class="u-my-300" style="text-align: center;">
      <button class="btn btn--primary" id="modify">修改</button>
      <button class="btn btn--secondary" id="update">更新</button>
    </div>
  </div>`
  return div
}
insertBefore(createAddress(), document.querySelector('.main-info-column .description, .js-market-item-detail-description'))
document.querySelector('#modify').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'openOptionsPage' })
})
document.querySelector('#update').addEventListener('click', downloadAddresses)

downloadAddresses()
