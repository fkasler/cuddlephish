async function resize_window(browser, page, width, height) {
  await page.setViewport({height, width})
  // Window frame - probably OS and WM dependent.
  //height += 85
  height += 225
  // Any tab.
  const targets = await browser._connection.send(
    'Target.getTargets'
  )
  // modified code
  const target = targets.targetInfos.filter(t => t.attached === true && t.type === 'page')[0]
  // Tab window. 
  const {windowId} = await browser._connection.send(
    'Browser.getWindowForTarget',
    {targetId: target.targetId}
  )
  const {bounds} = await browser._connection.send(
    'Browser.getWindowBounds',
    {windowId}
  )
  const resize = async () => {
    await browser._connection.send('Browser.setWindowBounds', {
      bounds: {width: width, height: height},
      windowId
    })
  }
  if(bounds.windowState === 'normal') {
    await resize()
  } else {
    await browser._connection.send('Browser.setWindowBounds', {
      bounds: {windowState: 'minimized'},
      windowId
    })
    await resize()
  }
}

export default resize_window
