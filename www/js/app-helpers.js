(function(root) {
  function normalizeCategoryOrder(categories) {
    return Array.isArray(categories)
      ? categories.filter(c => typeof c === 'string' && c.trim().length > 0)
      : []
  }

  function normalizeGearCategory(category) {
    return (category || '').toString().trim()
  }

  function getRenderableGearCategories(categories, groupedItems, showEmpty) {
    const orderedCategories = Array.isArray(categories) ? categories : []
    const grouped = groupedItems || {}
    const nonEmpty = []
    const empty = []

    orderedCategories.forEach(category => {
      const items = grouped[category] || []
      if (items.length > 0) {
        nonEmpty.push(category)
      } else if (showEmpty) {
        empty.push(category)
      }
    })

    return nonEmpty.concat(empty)
  }

  function matchesStorageFilter(storageId, selectedStorageIds) {
    const selected = Array.isArray(selectedStorageIds)
      ? selectedStorageIds.filter(Boolean)
      : []
    if (selected.length === 0) return true
    return Boolean(storageId) && selected.includes(storageId)
  }

  function getStorageFilterLabel(selectedStorageIds, storages) {
    const selected = Array.isArray(selectedStorageIds)
      ? selectedStorageIds.filter(Boolean)
      : []
    if (selected.length === 0) return 'All storages'
    if (selected.length === 1) {
      const storage = Array.isArray(storages)
        ? storages.find(item => item && item.id === selected[0])
        : null
      return storage?.name || '1 storage'
    }
    return `${selected.length} storages`
  }

  function buildChecklistShareUrl(origin, pathname, shareCode) {
    return `${origin}${pathname}?checklist=${encodeURIComponent(shareCode)}`
  }

  function buildChecklistShareData(checklist) {
    return {
      name: checklist.name,
      created_at: checklist.created,
      start_date: checklist.startDate,
      end_date: checklist.endDate,
      tags: checklist.tags,
      items: checklist.items || []
    }
  }

  function shouldCollapseCategory(catCount, collapsedStates, categoryName) {
    if (catCount === 0) return true
    if (collapsedStates && Object.prototype.hasOwnProperty.call(collapsedStates, categoryName)) {
      return Boolean(collapsedStates[categoryName])
    }
    return true
  }

  function shouldCollapseChecklist(collapsedStates, checklistId) {
    if (collapsedStates && Object.prototype.hasOwnProperty.call(collapsedStates, checklistId)) {
      return Boolean(collapsedStates[checklistId])
    }
    return true
  }

  const api = {
    buildChecklistShareData,
    buildChecklistShareUrl,
    getRenderableGearCategories,
    getStorageFilterLabel,
    matchesStorageFilter,
    normalizeCategoryOrder,
    normalizeGearCategory,
    shouldCollapseCategory,
    shouldCollapseChecklist
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }

  root.AppHelpers = api
})(typeof window !== 'undefined' ? window : globalThis)
