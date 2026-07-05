(function(root) {
  function isStorageImagePath(path) {
    return typeof path === 'string'
      && path.length > 0
      && !path.startsWith('data:')
      && !/^https?:\/\//i.test(path)
  }

  function getCacheablePhotoUrls(photoUrls, imagePaths) {
    const currentStoragePaths = new Set((imagePaths || []).filter(isStorageImagePath))

    return Object.fromEntries(
      Object.entries(photoUrls || {})
        .filter(([path]) => currentStoragePaths.has(path))
    )
  }

  const api = {
    isStorageImagePath,
    getCacheablePhotoUrls
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }

  root.PhotoUrlCache = api
})(typeof window !== 'undefined' ? window : globalThis)
