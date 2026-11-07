// Classic content scripts can't be ES modules, so load the real entry point as one.
(async () => {
  const { main } = await import(chrome.runtime.getURL('src/content/main.js'));
  main();
})();
