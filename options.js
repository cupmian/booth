const form = document.querySelector('form')

chrome.storage.local.get('options', (result) => {
  const { options = {} } = result
  Object.entries(options).map(([k, v]) => {
    const input = document.querySelector(`input[name="${k}"]`)
    if (!input) {
      return
    }
    if (input.type === 'radio') {
      document.querySelectorAll(`input[name="${k}"]`).forEach(ipt => {
        ipt.checked = ipt.value === String(v)
      })
    } else {
      input.value = v
    }
  })
})

form.addEventListener('submit', (event) => {
  event.preventDefault()
  return uploadOptions()
})

const uploadOptions = async () => {
  const options = Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => {
    const input = document.querySelector(`input[name="${k}"]`)
    if (input.dataset.type === 'number') {
      return [k, Number(v)]
    } else if (input.dataset.type === 'boolean') {
      return [k, v === 'true']
    }
    return [k, v]
  }))
  return chrome.storage.local.set({ options })
}
