document.getElementById('getStorageData').addEventListener('click', () => {
  chrome.runtime.sendMessage({action: "getAllStorageData"}, (response) => {
    if (response.error) {
      document.getElementById('output').value = `Error: ${response.error}`;
    } else {
      document.getElementById('output').value = JSON.stringify(response, null, 2);
    }
  });
});

document.getElementById('searchButton').addEventListener('click', () => {
  const searchTerm = document.getElementById('searchInput').value.toLowerCase();
  chrome.runtime.sendMessage({action: "getAllStorageData"}, (response) => {
    if (response.error) {
      document.getElementById('output').value = `Error: ${response.error}`;
    } else {
      const result = {
        url: response.url,
        cookies: response.cookies.filter(cookie => cookie.name.toLowerCase().includes(searchTerm)),
        localStorage: Object.entries(response.localStorage)
          .filter(([key]) => key.toLowerCase().includes(searchTerm))
          .reduce((obj, [key, value]) => {
            obj[key] = value;
            return obj;
          }, {})
      };
      document.getElementById('output').value = JSON.stringify(result, null, 2);
    }
  });
});

document.getElementById('setStorageData').addEventListener('click', () => {
  const data = document.getElementById('output').value;
  chrome.runtime.sendMessage({action: "setStorageData", data: data}, (response) => {
    if (response.success) {
      alert('Storage data set successfully!');
    } else {
      alert(`Failed to set storage data: ${response.error}`);
    }
  });
});
