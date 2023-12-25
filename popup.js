const container = document.querySelector('#container')
const update = () => chrome.runtime.sendMessage({ action: 'getTasks' }, (message) => {
  const tasks = JSON.parse(message)
  container.innerHTML = Object.values(tasks).map(
    ({
       options: { payment, shipping, name, zip, prefecture, address1, address2, phone },
       productBrand, scheduledTime, products,
     }, index) => `
<div style="border: 1px solid black; padding: 8px;">
  <div>
    <span>卖家</span>
    <span>${productBrand}</span>
  </div>
  <div>
    <span>预约下单时间</span>
    <span>${new Date(scheduledTime)}</span>
  </div>
  ${Object.entries(products).map(([productId, variants]) => `
  <ul>
    <div><b>商品</b> <a href="${`https://booth.pm/ja/items/${productId}`}" target="_blank">${productId}</a></div>
    ${Object.entries(variants).map(([variant, quantity]) => `
    <li>
      <div><span>型号</span> ${variant ? `<a href="${`https://booth.pm/ja/items/${productId}#:~:text=${variant}`}" target="_blank">${variant}</a>` : '待定'}</div>
      <div><span>数量</span> <span>${quantity}</span></div>
    </li>`).join('')}
  </ul>`).join('')}
  <div>
    <b>支付方式</b>
    <span>${((payment) => {
      if (payment === 'pixivpay_paypal') return 'Paypal'
      if (payment === 'econtext') return '银行便利店'
      return payment
    })(payment)}</span>
  </div>
  <div>
    <b>邮寄方式</b>
    <span>${((shipping) => {
      if (shipping === 'box') return '宅配便'
      return shipping
    })(shipping)}</span>
  </div>
  <div>
    <b>氏名</b>
    <span>${name}</span>
  </div>
  <div>
    <b>郵便番号</b>
    <span>${zip}</span>
  </div>
  <div>
    <b>都道府県</b>
    <span>${prefecture}</span>
  </div>
  <div>
    <b>市区町村・丁目・番地</b>
    <span>${address1}</span>
  </div>
  <div>
    <b>マンション・建物名・部屋番号</b>
    <span>${address2}</span>
  </div>
  <div>
    <b>電話番号</b>
    <span>${phone}</span>
  </div>
  <div style="text-align: right;">
    <button id="btn-${index}">取消预约</button>
  </div>
</div>`).join('')
  if (Object.keys(tasks).length === 0) {
    container.innerHTML = '没有预约订单'
  }
  Object.entries(tasks).forEach(([key], index) => {
    document.querySelector(`#btn-${index}`).addEventListener('click',
      () => chrome.runtime.sendMessage({ action: 'deleteTask', data: key }, update),
    )
  })
})
setInterval(update, 30000)
update()

