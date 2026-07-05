(function(){
  // App loader
  const appLoader = document.getElementById('appLoader')

  function showLoader(text = 'Loading your gear...') {
    if (appLoader) {
      const loaderText = appLoader.querySelector('.loader-text')
      if (loaderText) loaderText.textContent = text
      appLoader.classList.remove('hidden')
    }
  }

  function hideLoader() {
    if (appLoader) {
      setTimeout(() => {
        appLoader.classList.add('hidden')
      }, 300)
    }
  }

  // Authentication state
  let isAuthenticated = false
  let isLoading = false
  let authSubscription = null

  // form elements
  const form = document.getElementById('gearForm')
  const category = document.getElementById('category')
  const nameInput = document.getElementById('name')
  const brand = document.getElementById('brand')
  const model = document.getElementById('model')
  const weight = document.getElementById('weight')
  const price = document.getElementById('price')
  const year = document.getElementById('year')
  const storageSelect = document.getElementById('storage')
  const comment = document.getElementById('comment')
  const saveBtn = document.getElementById('saveBtn')
  const resetBtn = document.getElementById('resetBtn')

  const search = document.getElementById('search')
  const filterCategory = document.getElementById('filterCategory')
  const cardsEl = document.getElementById('cards')
  const countEl = document.getElementById('count')
  const totalWeightEl = document.getElementById('totalWeight')
  const totalPriceEl = document.getElementById('totalPrice')

  const modal = document.getElementById('modal')
  const addBtn = document.getElementById('addBtn')
  const closeModalBtn = document.getElementById('closeModal')
  const modalTitle = document.getElementById('modalTitle')

  let items = []
  let editingId = null
  let currentPhotoData = null
  const MAX_IMAGE_SIZE = 1024 * 1024 // 1MB target limit
  const photoUrlCache = window.PhotoUrlCache
  const appHelpers = window.AppHelpers
  const visibilityUI = window.VisibilityUI
  let visibilityEntitlements = { canUsePrivateVisibility: false }

  // Storage management
  let storages = [] // Array of storage locations {id, name, created}
  let currentStorageFilters = [] // empty = show all, otherwise selected storage ids
  let visibleSearchResults = null
  let visibleSearchScope = 'mine'
  let showEmptyGearCategories = false
  let currentChecklistStorageFilter = {} // {checklistId: storageId} - filters per checklist
  let checklistCategorySortState = {} // {checklistId: {category: {type: 'name', order: 'asc'}}} - sort state per checklist category
  let checklistCollapsedState = {} // {checklistId: boolean} - track which checklists are collapsed

  function renderVisibilityBadges(resource) {
    return visibilityUI ? visibilityUI.renderVisibilityBadge(resource || {}) : ''
  }

  function renderVisibilityPicker(containerId, resource = {}) {
    const container = document.getElementById(containerId)
    if (!container || !visibilityUI) return
    visibilityUI.renderVisibilityPicker(container, {
      value: resource.visibility || 'public',
      entitlements: visibilityEntitlements,
      grants: resource.grants || []
    })
  }

  function getVisibilityValue(containerId) {
    const container = document.getElementById(containerId)
    return visibilityUI ? visibilityUI.getSelectedVisibility(container) : 'public'
  }

  function canEditResource(resource) {
    const accessSource = resource?.accessSource || resource?.access_source
    const ownerId = resource?.userId || resource?.user_id || resource?.owner_id
    if (!accessSource && !ownerId) return true
    if (visibilityUI?.canEditResource) return visibilityUI.canEditResource(resource)
    return accessSource === 'mine'
  }

  function alertOwnerOnly(resourceType) {
    alert(`Only your own ${resourceType} can be edited.`)
  }

  function normalizeStorageRating(value) {
    return Math.max(0, Math.min(5, Number(value) || 0))
  }

  function renderStorageRatingStars(value) {
    const rating = normalizeStorageRating(value)
    return `<span class="storage-rating-display" title="Rating: ${rating}/5">${[1, 2, 3, 4, 5].map(star => `<span class="star${star <= rating ? ' active' : ''}">★</span>`).join('')}</span>`
  }

  function setStorageRatingValue(input, value) {
    if (!input) return
    const rating = normalizeStorageRating(value)
    input.value = String(rating)
    document.querySelectorAll(`.storage-rating-stars[data-rating-input="${input.id}"] .storage-rating-star`).forEach(star => {
      const starValue = Number(star.dataset.ratingValue) || 0
      star.classList.toggle('active', starValue <= rating)
      star.setAttribute('aria-checked', starValue === rating ? 'true' : 'false')
    })
  }

  function initializeStorageRatingStars() {
    document.querySelectorAll('.storage-rating-stars').forEach(group => {
      const input = document.getElementById(group.dataset.ratingInput)
      group.querySelectorAll('.storage-rating-star').forEach(star => {
        star.setAttribute('role', 'radio')
        star.addEventListener('click', () => {
          const selected = Number(star.dataset.ratingValue) || 0
          const current = normalizeStorageRating(input?.value)
          setStorageRatingValue(input, current === selected ? 0 : selected)
        })
      })
      setStorageRatingValue(input, input?.value || 0)
    })
  }

  initializeStorageRatingStars()

  // Immediately clean any legacy 'kitchen' entry from localStorage (persistent client-side state)
  let localStorageUpdated = false

  try {
    const rawCat = localStorage.getItem('allmygear.categoryOrder')
    if (rawCat) {
      const arr = JSON.parse(rawCat)
      if (Array.isArray(arr)) {
        let filtered = appHelpers.normalizeCategoryOrder(arr)

        if (filtered.length !== arr.length || JSON.stringify(filtered) !== JSON.stringify(arr)) {
          localStorage.setItem('allmygear.categoryOrder', JSON.stringify(filtered))
          localStorageUpdated = true
        }
      }
    }
  } catch (e) {
    console.warn('Could not clean localStorage categoryOrder on startup:', e)
  }

  // If user already signed in, ask Supabase to remove the legacy category from DB and add new categories
  (async () => {
    try {
      if (window.SupabaseService && SupabaseService.currentUser) {
        await SupabaseService.removeKitchenCategoryEverywhere()

        // Add new categories to category order in Supabase if not present
        const categoryOrderData = await SupabaseService.getCategoryOrder()
        if (categoryOrderData && categoryOrderData.categories && Array.isArray(categoryOrderData.categories)) {
          let cats = categoryOrderData.categories
          let updated = false

          // Add "Photo/Video Gear" before "Ride Gear"
          if (!cats.includes('Photo/Video Gear')) {
            const rideGearIndex = cats.indexOf('Ride Gear')
            if (rideGearIndex > -1) {
              cats.splice(rideGearIndex, 0, 'Photo/Video Gear')
            } else {
              const consumablesIndex = cats.indexOf('Consumables')
              if (consumablesIndex > -1) {
                cats.splice(consumablesIndex, 0, 'Photo/Video Gear')
              } else {
                cats.push('Photo/Video Gear')
              }
            }
            updated = true
          }

          // Add "Ride Gear" before "Consumables"
          if (!cats.includes('Ride Gear')) {
            const consumablesIndex = cats.indexOf('Consumables')
            if (consumablesIndex > -1) {
              cats.splice(consumablesIndex, 0, 'Ride Gear')
            } else {
              cats.push('Ride Gear')
            }
            updated = true
          }

          if (updated) {
            await SupabaseService.saveCategoryOrder(cats)
          }
        }
      }
    } catch (err) {
      // Silently ignore legacy cleanup errors
    }
  })()

  // Function to smoothly animate background color transition
  function animateBackgroundTransition(targetColors, isFromGear = false) {
    // Define starting colors based on current mode
    const startColors = isFromGear ? [
      {color: '#0f1f1d', position: 0},
      {color: '#1a2f2d', position: 20},
      {color: '#0f1f1d', position: 80},
      {color: '#203733', position: 100}
    ] : [
      {color: '#2B3A42', position: 0},
      {color: '#1F2D35', position: 20},
      {color: '#2B3A42', position: 80},
      {color: '#1A252C', position: 100}
    ]

    const duration = 8000 // 8 seconds
    const startTime = performance.now()

    function hexToRgb(hex) {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
      return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      } : null
    }

    function rgbToHex(r, g, b) {
      return "#" + ((1 << 24) + (Math.round(r) << 16) + (Math.round(g) << 8) + Math.round(b)).toString(16).slice(1)
    }

    function interpolateColor(color1, color2, progress) {
      const rgb1 = hexToRgb(color1)
      const rgb2 = hexToRgb(color2)
      if (!rgb1 || !rgb2) return color2

      const r = rgb1.r + (rgb2.r - rgb1.r) * progress
      const g = rgb1.g + (rgb2.g - rgb1.g) * progress
      const b = rgb1.b + (rgb2.b - rgb1.b) * progress

      return rgbToHex(r, g, b)
    }

    function animate(currentTime) {
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)

      // Use easing function
      const easeProgress = 1 - Math.pow(1 - progress, 3) // ease-out cubic

      // Interpolate colors
      const interpolatedColors = targetColors.map((target, index) => {
        const startColor = startColors[index] ? startColors[index].color : startColors[0].color
        return interpolateColor(startColor, target.color, easeProgress)
      })

      // Apply gradient
      const gradient = `linear-gradient(135deg, ${interpolatedColors[0]} ${targetColors[0].position}%, ${interpolatedColors[1]} ${targetColors[1].position}%, ${interpolatedColors[2]} ${targetColors[2].position}%, ${interpolatedColors[3]} ${targetColors[3].position}%)`
      document.body.style.background = gradient

      if (progress < 1) {
        requestAnimationFrame(animate)
      }
    }

    requestAnimationFrame(animate)
  }

  // Category order management
  let categoryOrder = []
  let categorySortMode = {} // Stores sort mode for each category: {categoryName: 'name'|'weight'|etc}
  let statsCache = {} // Cache for category statistics

  // Debounced render to prevent multiple re-renders
  let _renderTimer = null
  let _renderPending = false
  function scheduleRender() {
    if (_renderPending) return
    _renderPending = true
    requestAnimationFrame(() => {
      _renderPending = false
      render()
    })
  }

  // Invalidate stats cache
  function invalidateStatsCache() {
    statsCache = {}
  }

  // Debounced save for category order to avoid many network calls
  let _saveCategoryOrderTimer = null
  function debouncedSaveCategoryOrder() {
    if (_saveCategoryOrderTimer) clearTimeout(_saveCategoryOrderTimer)
    _saveCategoryOrderTimer = setTimeout(async ()=>{
      try {
        if (window.SupabaseService && SupabaseService.getCurrentUser && SupabaseService.getCurrentUser()) {
          await SupabaseService.saveCategoryOrder(categoryOrder, categorySortMode)
        }
      } catch (err) {
        console.error('Error saving category order:', err)
      }
    }, 500)
  }

  function reorderCategory(catName, direction) {
    const i = categoryOrder.indexOf(catName)
    if (i === -1) return
    const j = direction === 'up' ? i - 1 : i + 1
    if (j < 0 || j >= categoryOrder.length) return
    // swap
    ;[categoryOrder[i], categoryOrder[j]] = [categoryOrder[j], categoryOrder[i]]

    // Move DOM node
    const from = document.querySelector(`.category-section[data-category="${CSS.escape(catName)}"]`)
    const to = document.querySelector(`.category-section[data-category="${CSS.escape(categoryOrder[i])}"]`)
    if (from && to && to.parentNode) {
      if (direction === 'up') {
        to.parentNode.insertBefore(from, to)
      } else {
        to.parentNode.insertBefore(from, to.nextSibling)
      }
    }

    // Update category dropdown to reflect new order
    updateCategorySelect()

    // Save (debounced)
    debouncedSaveCategoryOrder()
  }

  // Category order editor modal
  function openCategoryOrderModal(){
    // If modal already open, focus
    if(document.querySelector('.category-order-modal')) return

    const overlay = document.createElement('div')
    overlay.className = 'category-order-modal overlay'
    overlay.innerHTML = `
      <div class="category-order-modal-card">
        <div class="modal-header">
          <h3>Edit Category Order</h3>
          <button type="button" class="btn icon modal-close" aria-label="Close">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 6 L18 18 M6 18 L18 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <p class="muted">Drag categories to reorder them.</p>
          <ul class="category-order-list">
            ${categoryOrder.map(cat => `<li data-cat="${escapeHtml(cat)}" draggable="true"><span class="co-left"><span class="drag-handle" aria-hidden="true">⋮⋮</span><span class="co-name">${escapeHtml(cat)}</span></span></li>`).join('')}
          </ul>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn secondary btn-secondary" data-action="cancel-order">Cancel</button>
          <button type="button" class="btn primary btn-primary" data-action="save-order">Save</button>
        </div>
      </div>`
    document.body.appendChild(overlay)

    // Close handler
    overlay.querySelector('.modal-close').addEventListener('click', ()=>closeCategoryOrderModal())
    overlay.querySelector('[data-action="cancel-order"]').addEventListener('click', ()=>closeCategoryOrderModal())

    const listEl = overlay.querySelector('.category-order-list')

    // Drag & drop handlers for list items
    function getDragAfterElement(container, y) {
      const draggableElements = [...container.querySelectorAll('li:not(.dragging)')]
      let closest = { offset: Number.NEGATIVE_INFINITY, element: null }
      draggableElements.forEach(child => {
        const box = child.getBoundingClientRect()
        const offset = y - box.top - box.height / 2
        if (offset < 0 && offset > closest.offset) {
          closest = { offset, element: child }
        }
      })
      return closest.element
    }

    function attachDragHandlers(listEl, overlay){
      listEl.querySelectorAll('li').forEach(li => {
        li.addEventListener('dragstart', (ev)=>{
          li.classList.add('dragging')
          ev.dataTransfer.effectAllowed = 'move'
          ev.dataTransfer.setData('text/plain', li.dataset.cat)
        })
        li.addEventListener('dragend', ()=>{
          li.classList.remove('dragging')
          // update categoryOrder from DOM
          categoryOrder = [...listEl.querySelectorAll('li')].map(x => x.dataset.cat)
        })
        li.addEventListener('dragover', (ev)=>{
          ev.preventDefault()
        })
      })

      listEl.addEventListener('dragover', (ev)=>{
        ev.preventDefault()
        const dragging = overlay.querySelector('.dragging')
        if(!dragging) return
        const afterElement = getDragAfterElement(listEl, ev.clientY)
        if(!afterElement){
          listEl.appendChild(dragging)
        } else {
          listEl.insertBefore(dragging, afterElement)
        }
      })

      listEl.addEventListener('drop', (ev)=>{
        ev.preventDefault()
        // finalize order
        categoryOrder = [...listEl.querySelectorAll('li')].map(x => x.dataset.cat)
      })
    }

    // initial attach
    attachDragHandlers(listEl, overlay)

    // Save handler
    overlay.querySelector('[data-action="save-order"]').addEventListener('click', async ()=>{
      try{
        // Ensure categoryOrder matches current list DOM
        const ul = overlay.querySelector('.category-order-list')
        categoryOrder = [...ul.querySelectorAll('li')].map(x => x.dataset.cat)
        // Apply ordering to DOM: append sections in new order
        categoryOrder.forEach(cat => {
          const node = document.querySelector(`.category-section[data-category="${cat}"]`)
          if(node) cardsEl.appendChild(node)
        })
        // Update category dropdown to reflect new order
        updateCategorySelect()
        debouncedSaveCategoryOrder()
      }catch(err){
        console.error('Error saving category order from modal:', err)
      }
      closeCategoryOrderModal()
    })
  }

  function closeCategoryOrderModal(){
    const overlay = document.querySelector('.category-order-modal.overlay')
    if(overlay) overlay.remove()
  }

  // Placeholder function for removed items order modal functionality
  function closeItemsOrderModal(){
    const overlay = document.querySelector('.items-order-modal.overlay')
    if(overlay) overlay.remove()
  }

  // Function to render checklist checkboxes in add gear form
  function renderAddToChecklistsSection() {
    const section = document.getElementById('addToChecklistsSection')
    const container = document.getElementById('addToChecklistsContainer')

    const editableChecklists = (checklists || []).filter(canEditResource)
    if(editableChecklists.length === 0) {
      section.style.display = 'none'
      return
    }

    section.style.display = 'block'
    container.innerHTML = editableChecklists.map(cl => `
      <label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;">
        <input type="checkbox" class="add-to-checklist-checkbox" data-checklist-id="${cl.id}" style="cursor:pointer;width:18px;height:18px;">
        <span style="font-size:13px;">${cl.name}</span>
      </label>
    `).join('')
  }

  // Outdoor gear brands database - comprehensive list
  const outdoorBrands = [...new Set([
    // Premium Outdoor & Alpine
    'Arc\'teryx', 'Patagonia', 'The North Face', 'Mammut', 'Marmot', 'Mountain Hardwear',
    'Outdoor Research', 'Rab', 'Montane', 'Montbell', 'Haglöfs', 'Norrøna', 'Bergans',
    'Fjallraven', 'Helly Hansen', 'Peak Performance', 'Tierra', 'Klättermusen', 'Lundhags',

    // Technical Climbing & Mountaineering
    'Black Diamond', 'Petzl', 'DMM', 'Wild Country', 'Grivel', 'Camp', 'Edelrid',
    'Beal', 'Sterling', 'Metolius', 'Trango', 'Simond', 'Singing Rock',

    // Footwear
    'Salomon', 'La Sportiva', 'Scarpa', 'Merrell', 'Keen', 'Lowa', 'Asolo', 'Zamberlan',
    'Vasque', 'Oboz', 'Danner', 'Altra', 'Hoka One One', 'Topo Athletic', 'Inov-8',
    'Adidas Terrex', 'Nike ACG', 'Meindl', 'Hanwag', 'Garmont', 'Tecnica', 'Boreal',

    // Backpacks & Bags
    'Osprey', 'Deuter', 'Gregory', 'Mystery Ranch', 'Hyperlite Mountain Gear', 'Zpacks',
    'Granite Gear', 'ULA', 'Six Moon Designs', 'Gossamer Gear', 'LiteAF', 'Mountain Laurel Designs',
    'Stone Glacier', 'Kifaru', 'Hill People Gear', 'Eberlestock', 'Kelty',
    'Karrimor', 'Tatonka', 'Bach', 'Exped', 'Lowe Alpine', 'F-Stop', 'Shimoda', 'Mindshift Gear',

    // Tents & Shelters
    'Hilleberg', 'MSR', 'Big Agnes', 'Nemo', 'Terra Nova', 'Tarptent', 'Durston',
    'Sea to Summit', 'Sierra Designs', 'Alps Mountaineering',
    'Eureka', 'Nordisk', 'Vaude', 'Robens', 'Wechsel', 'Vango', 'Snugpak',

    // Sleeping Bags & Pads
    'Western Mountaineering', 'Feathered Friends', 'Enlightened Equipment', 'Therm-a-Rest',
    'Klymit', 'REI', 'Cumulus', 'Valandré', 'PHD', 'Timmermade', 'Nunatak', 'Katabatic',

    // Camp Furniture & Accessories
    'Helinox', 'Crazy Creek', 'ENO', 'Grand Trunk', 'Trekology', 'Moon Lence', 'Cascade Mountain Tech',

    // Cooking & Stoves
    'JetBoil', 'Primus', 'Optimus', 'Trangia', 'Snow Peak', 'GSI Outdoors', 'Stanley',
    'Toaks', 'Evernew', 'Olicamp', 'Vargo', 'Soto', 'Kovea', 'Fire-Maple', 'BRS', 'Esbit',

    // Hydration & Water Treatment
    'CamelBak', 'Platypus', 'Sawyer', 'Katadyn', 'LifeStraw', 'Grayl', 'HydraPak',
    'Nalgene', 'Klean Kanteen', 'Hydro Flask', 'Yeti', 'RTIC', 'Orca', 'SIGG',
    'Geigerrig', 'Source', 'SteriPen', 'Aquamira', 'Potable Aqua',

    // Electronics & Navigation
    'Garmin', 'Suunto', 'Spot', 'InReach', 'BioLite', 'Goal Zero', 'Anker', 'Nitecore',
    'Fenix', 'Olight', 'Ledlenser', 'Princeton Tec', 'Streamlight',
    'Brunton', 'Silva', 'Bushnell', 'Magellan', 'Coros', 'Wahoo', 'Polar', 'Apple', 'Samsung',

    // Clothing - Base & Mid Layers
    'Icebreaker', 'Smartwool', 'Ibex', 'Minus33', 'Kari Traa', 'Devold', 'Ulvang', 'Aclima', 'Houdini',

    // Socks
    'Darn Tough', 'Farm to Feet', 'Point6', 'Fox River', 'Wigwam', 'Injinji',
    'Defeet', 'Balega', 'Thorlo', 'Bridgedale', 'Lorpen', 'Fits',

    // Hunting & Tactical
    'Sitka', 'Kuiu', 'First Lite', 'Kryptek', 'HECS',
    'Badlands', 'Under Armour', 'Cabela\'s', 'Bass Pro Shops', 'Browning', 'Mossy Oak', 'Realtree',

    // Budget & Mass Market
    'Decathlon', 'Quechua', 'Forclaz', 'Naturehike', 'Coleman', 'Teton Sports', 'ALPS Mountaineering',
    'High Sierra', 'REI Co-op', 'Amazon Basics', 'Ozark Trail', 'Equip', 'Chinook',

    // Chinese Outdoor Brands
    '3F UL Gear', 'Black Deer', 'Fire-Maple', 'TiGoat', 'CNOC Outdoors', 'Flame\'s Creed',
    'MIER', 'Pomoly', 'OneTigris', 'REDCAMP', 'Lixada', 'Tomshoo', 'Odoland', 'Widesea',
    'Hewolf', 'Mobi Garden', 'Kailas', 'Toread', 'ALPINT MOUNTAIN', 'AEGISMAX', 'Paria Outdoor',
    'Lanshan', 'River Country Products', 'ZPacks China', 'Ultralight Outdoor Gear', 'Wind Hard',
    'Shuangfeng', 'Yougle', 'Trackman', 'Camppal', 'Skypeople', 'Creeper', 'Trekkinn',
    'Hillman', 'FACECOZY', 'Boundless Voyage', 'Bulin', 'AOTU', 'Etekcity', 'Coghlan\'s',

    // Specialty & Niche
    'Eagle Creek', 'Peak Design', 'Lowepro', 'Tom Bihn', 'Maxpedition', '5.11 Tactical', 'Condor',
    'Triple Aught Design', 'GORUCK', 'Chrome', 'Timbuk2', 'Ortlieb', 'Revelate', 'Apidura',

    // International & Regional
    'Fjällräven', 'Didriksons', 'Halti', 'Reima', 'Icepeak', 'Rukka', 'Jack Wolfskin', 'Schöffel',
    'Salewa', 'Dynafit', 'Ortovox', 'Prana', 'Kühl', 'Royal Robbins',

    // Ultralight & Cottage Brands
    'Borah Gear', 'Yama Mountain Gear', 'Simply Light Designs', 'Pa\'lante', 'Superior Wilderness Designs',

    // Paddle Sports
    'NRS', 'Astral', 'Kokatat', 'Aqua-Bound', 'Werner Paddles', 'Bending Branches', 'Perception',
    'Dagger', 'Wilderness Systems', 'Old Town', 'Pelican', 'Oru Kayak', 'Advanced Elements',

    // Winter Sports
    'Pieps', 'BCA', 'Arva', 'G3', 'Pomoca',
    'Contour', 'Colltex', 'Tubbs', 'Atlas', 'TSL', 'Yaktrax', 'Kahtoola', 'Hillsound',

    // Trail Running
    'Brooks', 'Saucony', 'New Balance', 'Nike', 'Adidas', 'On Running', 'Scott',

    // Knives & Multi-tools
    'Benchmade', 'Spyderco', 'Kershaw', 'CRKT', 'Buck', 'Gerber', 'SOG', 'Victorinox',
    'Leatherman', 'Cold Steel', 'Zero Tolerance', 'Mora', 'Morakniv', 'Helle', 'Opinel',
    'Ka-Bar', 'Esee', 'Tops', 'Fallkniven', 'Böker', 'Case', 'Ontario', 'Schrade',
    'Benchmade', 'Emerson', 'Microtech', 'Protech', 'Hinderer', 'Chris Reeve', 'Strider',
    'Extrema Ratio', 'Fox Knives', 'LionSteel', 'Real Steel', 'Ganzo', 'Sanrenmu',
    'Нокс', 'Кизляр', 'АиР', 'Лесной Ворон', 'Златоуст', 'Ножи Северная корона',

    // Ski & Snowboard Equipment
    'Atomic', 'Rossignol', 'Salomon', 'Fischer', 'Head', 'K2', 'Volkl', 'Blizzard',
    'Nordica', 'Tecnica', 'Scarpa', 'Burton', 'Ride', 'Jones', 'Capita', 'Never Summer',
    'Lib Tech', 'GNU', 'Arbor', 'Rome', 'Union', 'Bent Metal', 'Drake', 'Flux',
    'Smith', 'Oakley', 'Dragon', 'Anon', 'Giro', 'POC', 'Sweet Protection', 'Scott',
    'Marker', 'Tyrolia', 'Look', 'Fritschi', 'Plum', 'ATK', 'Trab', 'Movement',

    // Fishing Equipment
    'Shimano', 'Daiwa', 'Penn', 'Abu Garcia', 'Okuma', 'Rapala', 'Berkley', 'Pure Fishing',
    'Ugly Stik', 'St. Croix', 'G.Loomis', 'Fenwick', 'Lamiglas', 'Megabass', 'Lucky Craft',
    'Yo-Zuri', 'Mepps', 'Blue Fox', 'Eppinger', 'Strike King', 'Gary Yamamoto', 'Zoom',
    'Berkley PowerBait', 'Gulp', 'Z-Man', 'Savage Gear', 'Westin', 'Deps', 'OSP',
    'Aqua', 'Norstream', 'Волжанка', 'Mikado', 'Salmo', 'Balzer', 'DAM', 'Favorite',
    'Trabucco', 'Colmic', 'Maver', 'Matrix', 'Preston', 'Korda', 'Fox International',
    'Nash', 'Trakker', 'JRC', 'Sonik', 'Cygnet', 'Greys', 'Scierra', 'Loop', 'Rio',
    'Scientific Anglers', 'Cortland', 'Airflo', 'Sage', 'Redington', 'Echo', 'Temple Fork',
    'Orvis', 'Hardy', 'Snowbee', 'Guideline', 'Vision', 'Hatch', 'Nautilus', 'Ross',
    'Tibor', 'Abel', 'Galvan', 'Lamson', 'Bauer', 'Danielsson', 'Einarsson', 'Shilton',
    'Simms', 'Patagonia', 'Redington', 'Wrangler', 'Filson', 'Sitka', 'Grundens', 'Helly Hansen',
    'Frogg Toggs', 'Compass 360', 'Stormr', 'SunGloves', 'Buff', 'Costa Del Mar', 'Oakley',
    'Maui Jim', 'Smith Optics', 'Kaenon', 'Flying Fisherman', 'Cocoons', 'Solar Bat',
    'Wiley X', 'Hobie', 'Calcutta', 'Spotters', 'Bajio', 'REVO', 'Ray-Ban', 'Julbo',
    'Fortis', 'Korda', 'Aqua Products', 'Fox Rage', 'Spro', 'Gamakatsu', 'Owner', 'Mustad',
    'VMC', 'Trokar', 'Circle Hook Co', 'Eagle Claw', 'Lazer Sharp', 'Daiichi', 'Tiemco',
    'Partridge', 'Kamasan', 'Barbless', 'Umpqua', 'Montana Fly Company', 'Estes Park',
    'Regal', 'Griffin', 'Stonfo', 'Dr. Slick', 'Loon Outdoors', 'Solarez', 'Gehrke\'s',
    'Frogs Fanny', 'Zap-A-Gap', 'Bobbie\'s Boat', 'Fishpond', 'William Joseph', 'Vedavoo',
    'Abel', 'Bozeman', 'Mayfly', 'Umpqua', 'Scientific Anglers', 'Whiting Farms',
    'Ewing', 'Hareline', 'Nature\'s Spirit', 'Fly Scene', 'Wapsi', 'Veniard', 'Semperfli',
    'Antron', 'Krystal Flash', 'Flashabou', 'Slinky Fiber', 'EP Fibers', 'Fish-Skull',
    'Tungsten Beads', 'Spirit River', 'Rainy\'s', 'Fulling Mill', 'Ahrex', 'Hends',
    'Jig Force', 'BKK', 'Decoy', 'Hayabusa', 'Katsuichi', 'Fudo', 'Nogales', 'Varivas',
    'Sunline', 'Toray', 'Seaguar', 'Fluorocarbon', 'PowerPro', 'Fireline', 'SpiderWire',
    'Sufix', 'Stren', 'Trilene', 'Maxima', 'Amnesia', 'Rio Products', 'Airflo',
    'Wulff', 'Cortland', 'SA', 'Loop', 'Guideline', 'Vision', 'Snowbee', 'Shakespeare',
    'Leeda', 'Drennan', 'Sensas', 'Browning', 'Feeder Concept', 'Method Feeder', 'Guru',
    'Middy', 'Daiwa', 'Preston Innovations', 'MAP', 'Avid Carp', 'Thinking Anglers',
    'Sticky Baits', 'Mainline Baits', 'Dynamite Baits', 'CC Moore', 'Nutrabaits',
    'Rod Hutchinson', 'Solar Tackle', 'Chub', 'Taska', 'Gardner Tackle', 'Korum',
    'ESP', 'Rig Marole', 'PB Products', 'Thinking Anglers', 'Enterprise Tackle',

    // Hunting Equipment
    'Winchester', 'Remington', 'Beretta', 'CZ', 'Tikka', 'Sako', 'Weatherby', 'Savage Arms',
    'Benelli', 'Franchi', 'Stoeger', 'Mossberg', 'Marlin', 'Henry', 'Ruger', 'Smith & Wesson',
    'Glock', 'Sig Sauer', 'Heckler & Koch', 'FN Herstal', 'Steyr', 'Blaser', 'Merkel',
    'Krieghoff', 'Perazzi', 'Caesar Guerini', 'Beretta', 'Benelli', 'Franchi',
    'Leupold', 'Vortex', 'Zeiss', 'Swarovski', 'Schmidt & Bender', 'Nightforce',
    'Aimpoint', 'EOTech', 'Holosun', 'Primary Arms', 'Trijicon', 'Burris', 'Nikon',
    'Steiner', 'Meopta', 'Maven', 'Tract', 'Razor', 'Vixen', 'Minox', 'Kahles',
    'March', 'Tangent Theta', 'Premier', 'US Optics', 'IOR', 'Falcon', 'Hawke',
    'Crimson Trace', 'Streamlight', 'SureFire', 'Inforce', 'Olight', 'Fenix',
    'Магнум', 'Тигр', 'Сайга', 'Вепрь', 'Молот', 'Ижмаш', 'Байкал', 'ТОЗ',
    'ORSIS', 'Lobaev Arms', 'DVL', 'Chronos', 'Promag', 'Partisan',

    // Motorcycle Equipment
    'Alpinestars', 'Dainese', 'Rev\'It', 'Klim', 'Rukka', 'Held', 'Spidi', 'Richa',
    'Furygan', 'IXS', 'Tucano Urbano', 'Macna', 'Segura', 'Bering', 'Ixon', 'RST',
    'Frank Thomas', 'Oxford', 'Halvarssons', 'Lindstrands', 'Gerbing', 'Keis',
    'Shoei', 'Arai', 'AGV', 'HJC', 'Shark', 'Scorpion', 'Bell', 'LS2', 'MT Helmets',
    'Caberg', 'Nolan', 'X-Lite', 'Grex', 'Premier', 'Nexx', 'Airoh', 'Just1',
    'Sidi', 'TCX', 'Forma', 'Gaerne', 'Alpinestars', 'Fox Racing', 'O\'Neal',
    'Thor', 'Fly Racing', 'Answer Racing', 'MSR', 'Shift', 'Troy Lee Designs',
    'Leatt', 'Acerbis', 'Polisport', 'UFO', 'Racetech', 'Cycra', 'Enduro Engineering',
    'Kriega', 'SW-Motech', 'Givi', 'Shad', 'Kappa', 'Hepco & Becker', 'Touratech',
    'Ortlieb', 'Wolfman', 'Giant Loop', 'Mosko Moto', 'Rok Straps', 'Oxford',

    // Electronics & Tech
    'Sony', 'Panasonic', 'Canon', 'Nikon', 'Fujifilm', 'Olympus', 'Leica', 'Pentax',
    'Ricoh', 'Hasselblad', 'Phase One', 'RED Digital Cinema', 'Blackmagic Design',
    'GoPro', 'DJI', 'Insta360', 'Garmin', 'TomTom', 'Magellan', 'Lowrance', 'Humminbird',
    'Raymarine', 'Furuno', 'Simrad', 'B&G', 'Navico', 'Standard Horizon', 'Icom',
    'Yaesu', 'Kenwood', 'Motorola', 'Midland', 'Uniden', 'Cobra', 'Whistler',
    'Baofeng', 'TYT', 'Wouxun', 'Anytone', 'Ailunce', 'Radioddity', 'BridgeCom',
    'Yeti', 'Pelican', 'Otterbox', 'Watershot', 'AquaTech', 'DiCAPac', 'Ewa-Marine',
    'Peak Design', 'Think Tank', 'f-stop', 'Mindshift Gear', 'Tenba', 'Billingham',
    'Domke', 'ONA', 'Filson', 'Wotancraft', 'Manfrotto', 'Gitzo', 'Really Right Stuff',
    'Arca-Swiss', 'Kirk', 'Wimberley', 'Jobu Design', 'Promedia Gear', 'Benro',

    // Extreme Sports & Action Sports
    'GoPro', 'DJI', 'Insta360', 'Red Bull', 'Monster Energy', 'Fox Racing', 'Troy Lee Designs',
    'Alpinestars', 'O\'Neal', 'Fly Racing', 'Thor', '100%', 'Leatt', 'EVS Sports',
    'Pro-Tec', 'Triple Eight', 'S-One', 'Bern', 'TSG', 'POC', 'Demon',
    'Sector 9', 'Loaded', 'Landyachtz', 'Santa Cruz', 'Element', 'Plan B', 'Girl',
    'Vans', 'DC Shoes', 'Emerica', 'Etnies', 'Nike SB', 'Adidas Skateboarding',

    // Climbing Hardware & Protection
    'Metolius', 'C.A.M.P.', 'Fixe', 'Climb X', 'Mad Rock', 'Five Ten', 'Evolv', 'Butora',
    'So iLL', 'Unparallel', 'Red Chili', 'Tenaya', 'Boreal', 'Ocun', 'Edelweiss',

    // Mountaineering & Ice Climbing
    'Cassin', 'Charlet Moser', 'CAMP', 'Simond', 'Stubai', 'AustriAlpin', 'Climbing Technology',
    'Kong', 'Singing Rock', 'Rock Exotica', 'Yates', 'CMC Rescue', 'Petzl', 'Edelrid',

    // Survival & Bushcraft
    'Benchmade', 'Gerber', 'SOG', 'ESEE', 'Tops', 'Condor', 'Mora', 'Hultafors', 'Fiskars',
    'Gränsfors Bruk', 'Husqvarna', 'Stihl', 'Fiskars', 'Bahco', 'Silky', 'Corona',
    'Survival Metrics', 'SOL', 'UST', 'Light My Fire', 'UCO', 'Coghlan\'s', 'Coghlans',

    // Russian & Eastern European Brands
    'Splav', 'Bask', 'Red Fox', 'Normal', 'Nova Tour', 'Alexika', 'Сплав', 'Баск', 'Век',
    'Манарага', 'BASK', 'Trek Planet', 'Green Glade', 'Norfin', 'Следопыт', 'Fisherman',
    'Тонар', 'Helios', 'Наша Марка'
  ])].sort()

  function loadCategoryOrder(){
    const defaultCategories = ['Shelter', 'Sleep System', 'Camp Furniture', 'Clothing', 'Footwear', 'Packs & Bags', 'Cooking', 'Electronics', 'Lighting', 'First Aid / Safety', 'Personal items / Documents', 'Knives & Tools', 'Technical Gear', 'Sports Equipment', 'Fishing & Hunting', 'Climbing & Rope', 'Winter & Snow', 'Photo/Video Gear', 'Ride Gear', 'Consumables']
    // localStorage disabled - use defaults, data loaded from Supabase for authenticated users

    categorySortMode = {}

    // Set all categories to name mode by default
    defaultCategories.forEach(cat => {
      categorySortMode[cat] = 'name'
    })

    categoryOrder = defaultCategories
    updateCategorySelect()
  }

  // Update category select dropdown to match user's category order
  function updateCategorySelect() {
    const defaultCategories = ['Shelter', 'Sleep System', 'Camp Furniture', 'Clothing', 'Footwear', 'Packs & Bags', 'Cooking', 'Electronics', 'Lighting', 'First Aid / Safety', 'Personal items / Documents', 'Knives & Tools', 'Technical Gear', 'Sports Equipment', 'Fishing & Hunting', 'Climbing & Rope', 'Winter & Snow', 'Photo/Video Gear', 'Ride Gear', 'Consumables']

    // Use categoryOrder if available, otherwise use defaults
    const orderedCategories = (categoryOrder && categoryOrder.length > 0) ? categoryOrder : defaultCategories

    // Update main category select in add/edit form
    if (category) {
      const currentValue = category.value

      // Clear existing options except first (empty option)
      while (category.options.length > 1) {
        category.remove(1)
      }

      // Add categories in user's order
      orderedCategories.forEach(cat => {
        const option = document.createElement('option')
        option.value = cat
        option.textContent = cat
        category.appendChild(option)
      })

      // Restore previously selected value if it still exists
      if (currentValue && orderedCategories.includes(currentValue)) {
        category.value = currentValue
      }
    }

    // Update filter category dropdown
    if (filterCategory) {
      const currentFilterValue = filterCategory.value

      // Clear existing options except first (All categories)
      while (filterCategory.options.length > 1) {
        filterCategory.remove(1)
      }

      // Add categories in user's order
      orderedCategories.forEach(cat => {
        const option = document.createElement('option')
        option.value = cat
        option.textContent = cat
        filterCategory.appendChild(option)
      })

      // Restore previously selected filter value if it still exists
      if (currentFilterValue && orderedCategories.includes(currentFilterValue)) {
        filterCategory.value = currentFilterValue
      }
    }
  }

  function load(){
    // Data loaded from Supabase for authenticated users
    items = []
  }

  function uid(){
    // Generate UUID v4 compatible string
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0
      const v = c === 'x' ? r : (r & 0x3 | 0x8)
      return v.toString(16)
    })
  }

  function render(){
    // Clear stats cache on re-render
    statsCache = {}

    // Save collapsed states before re-rendering
    const collapsedStates = {}
    document.querySelectorAll('.category-section').forEach(catSection => {
      const category = catSection.dataset.category
      const itemsContainer = catSection.querySelector('.category-items')
      if (itemsContainer && category) {
        collapsedStates[category] = itemsContainer.classList.contains('collapsed')
      }
    })

    // Get search value from toolbar (if exists) or use empty string
    const searchInput = document.getElementById('search')
    const q = searchInput ? searchInput.value.trim().toLowerCase() : ''
    const searchWasFocused = searchInput && document.activeElement === searchInput
    const searchRawValue = searchInput ? searchInput.value : '' // Keep original case for restoring
    const cat = filterCategory.value
    const selectedStorageIds = currentStorageFilters
    const renderItems = visibleSearchResults || items
    const filtered = renderItems.filter(it=>{
      if(cat && it.category !== cat) return false
      if(!visibleSearchResults && !appHelpers.matchesStorageFilter(it.storageId, selectedStorageIds)) return false
      if(q){
        const matchName = it.name.toLowerCase().includes(q)
        const matchBrand = it.brand && it.brand.toLowerCase().includes(q)
        const matchModel = it.model && it.model.toLowerCase().includes(q)
        if(!matchName && !matchBrand && !matchModel) return false
      }
      return true
    })

    cardsEl.innerHTML = ''

    // Use saved category order or fallback to defaults
    const defaultCategories = ['Shelter', 'Sleep System', 'Camp Furniture', 'Clothing', 'Footwear', 'Packs & Bags', 'Cooking', 'Electronics', 'Lighting', 'First Aid / Safety', 'Personal items / Documents', 'Knives & Tools', 'Technical Gear', 'Sports Equipment', 'Fishing & Hunting', 'Climbing & Rope', 'Winter & Snow', 'Photo/Video Gear', 'Ride Gear', 'Consumables']

    // Clean up category order from old category names
    if (categoryOrder && categoryOrder.includes('Bag / Package')) {
      categoryOrder = categoryOrder.filter(cat => cat !== 'Bag / Package')
    }

    // Sanitize saved category order: remove empty/null entries and legacy 'kitchen'
    const sanitizedCategoryOrder = (categoryOrder || []).filter(c => typeof c === 'string' && c.trim().length > 0 && c.trim().toLowerCase() !== 'kitchen')
    const allCategories = (sanitizedCategoryOrder && sanitizedCategoryOrder.length > 0) ? sanitizedCategoryOrder : defaultCategories

    // Group items by category
    const grouped = {}
    const uncategorizedItems = []
    filtered.forEach(it=>{
      const normalizedCat = appHelpers.normalizeGearCategory(it.category)

      if(!normalizedCat){
        uncategorizedItems.push(it)
      } else {
        if(!grouped[normalizedCat]) grouped[normalizedCat] = []
        // Push a shallow clone with normalized category for rendering consistency
        const itemForGroup = { ...it, category: normalizedCat }
        grouped[normalizedCat].push(itemForGroup)
      }
    })

    // Don't sort items here - they should maintain their order from the items array
    // Sorting happens only when user explicitly changes sort mode via dropdown
    // grouped categories maintain order from items array

    // Use DocumentFragment for better performance
    const fragment = document.createDocumentFragment()

    // Render uncategorized items first (without category wrapper)
    uncategorizedItems.forEach(it=>{
      const el = document.createElement('article')
      el.className = 'card uncategorized-card'
      el.dataset.id = it.id
      const imgHtml = it.image ? `<img class="thumb" src="${it.image}" alt="${escapeHtml(it.name)}">` : ''

      // Generate checklist badges for this item
      const itemChecklists = checklists.filter(cl => cl.items && cl.items.some(clItem => clItem.itemId === it.id))
      const checklistBadgesHtml = itemChecklists.length > 0 ? `
        <div class="checklist-badges">
          ${itemChecklists.map(cl => `<span class="checklist-badge" title="${escapeHtml(cl.name)}">${escapeHtml(cl.name)}</span>`).join('')}
        </div>
      ` : ''

      const storageName = it.storageId ? storages.find(s => s.id === it.storageId)?.name : null
      const storageBadgeHtml = storageName ? `<span class="storage-badge" title="Storage: ${escapeHtml(storageName)}">${escapeHtml(storageName)}</span>` : ''
      const commentIconHtml = it.comment ? `<svg class="comment-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" title="Has comment"><path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z" fill="currentColor"/></svg>` : ''

      el.innerHTML = `
          <div class="card-compact-content">
            ${imgHtml}
            <div class="left">
              <div class="card-header">
                <h3 title="${escapeHtml(it.name)}">${escapeHtml(it.name)}</h3>
                ${commentIconHtml}
                ${storageBadgeHtml}
                ${renderVisibilityBadges(it)}
                <div class="weight-badge">${formatWeight(it.weight)}</div>
              </div>
              <div class="card-footer">
                <div class="attrs">
                  <span>${escapeHtml(it.brand||'-')}</span>
                  <span>${escapeHtml(it.model||'-')}</span>
                </div>
                <div class="card-price-section">
                  ${it.rating ? `<span class="rating-display">${'★'.repeat(it.rating)}${'☆'.repeat(5-it.rating)}</span>` : `<span class="rating-display"></span>`}
                  ${it.year ? `<span class="year-badge">${it.year}</span>` : ''}
                  <div class="price-badge">${it.price ? formatPrice(it.price) : '-'}</div>
                </div>
              </div>
            </div>
            <div class="right">
              <div class="actions">
                <button class="btn icon edit" data-action="edit" data-id="${it.id}" aria-label="Edit">
                  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                  </svg>
                </button>
                <button class="btn icon delete delete-edit" data-id="${it.id}" aria-label="Delete" style="display: none;">
                  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
          <div class="card-expanded-content">
            <div class="card-expanded-header">
              <div class="card-expanded-photo">
                <div class="photo-container" data-id="${it.id}">
                  ${it.image ? `<img src="${it.image}" alt="${escapeHtml(it.name)}">` : 'No photo'}
                  <input class="edit-field photo-file-input" type="file" accept="image/*,.heic,.heif" data-field="photo" data-id="${it.id}" style="display: none;">
                  <div class="photo-overlay-buttons">
                    <button class="photo-overlay-btn" data-action="replace-photo" data-id="${it.id}" title="Replace photo">
                      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path d="M19 12v7H5v-7M12 2.5l3.5 3.5L12 9.5 8.5 6z"/>
                        <path d="M12 9v9"/>
                      </svg>
                    </button>
                    <button class="photo-overlay-btn" data-action="add-photo" data-id="${it.id}" title="Add photo" style="${it.image ? 'display: none;' : ''}">
                      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path d="M19 7v2.99s-1.99.01-2 0V7h-3s.01-1.99 0-2h3V2h2v3h3v2h-3zm-3 4V9h-3V7H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-8h-3zM5 19l3-4 2 3 3-4 4 5H5z"/>
                      </svg>
                    </button>
                    <button class="photo-overlay-btn" data-action="remove-photo" data-id="${it.id}" title="Remove photo" style="${it.image ? '' : 'display: none;'}">
                      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
              <div class="card-expanded-info">
                <h3 class="card-expanded-title">${escapeHtml(it.name)}</h3>
                ${it.brand ? `<div class="card-expanded-brand">${escapeHtml(it.brand)} ${it.model ? escapeHtml(it.model) : ''}</div>` : ''}
                <div class="card-expanded-details">
                  <div class="card-expanded-detail weight-detail">
                    <div class="card-expanded-detail-label">Weight</div>
                    <div class="card-expanded-detail-value weight-value">${formatWeight(it.weight)}</div>
                  </div>
                  ${it.price ? `
                  <div class="card-expanded-detail">
                    <div class="card-expanded-detail-label">Price</div>
                    <div class="card-expanded-detail-value">${formatPrice(it.price)}</div>
                  </div>` : ''}
                  ${it.year ? `
                  <div class="card-expanded-detail">
                    <div class="card-expanded-detail-label">Year of purchase</div>
                    <div class="card-expanded-detail-value">${it.year}</div>
                  </div>` : ''}
                  ${it.rating ? `
                  <div class="card-expanded-detail">
                    <div class="card-expanded-detail-label">Level of satisfaction</div>
                    <div class="card-expanded-detail-value">${'★'.repeat(it.rating)}${'☆'.repeat(5-it.rating)}</div>
                  </div>` : ''}
                </div>
                ${checklistBadgesHtml}
                ${it.comment ? `
                <div class="card-comment">
                  <div class="card-comment-label">Comment</div>
                  <div class="card-comment-value">${escapeHtml(it.comment)}</div>
                </div>` : ''}
              </div>
            </div>
            <div class="right">
              <div class="actions">
                ${storageBadgeHtml}
                ${renderVisibilityBadges(it)}
                <button class="btn icon share" data-action="share" data-id="${it.id}" aria-label="Share" title="Share item">
                  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <circle cx="18" cy="5" r="3"/>
                    <circle cx="6" cy="12" r="3"/>
                    <circle cx="18" cy="19" r="3"/>
                    <path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" stroke="currentColor" stroke-width="1.5" fill="none"/>
                  </svg>
                </button>
                <button class="btn icon edit" data-action="edit" data-id="${it.id}" aria-label="Edit">
                  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                  </svg>
                </button>
                <button class="btn icon delete delete-edit" data-id="${it.id}" aria-label="Delete" style="display: none;">
                  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
          <div class="card-edit-form hidden">
            <div class="edit-fields">
              <div class="edit-section">
                <label>Name *</label>
                <input class="edit-field" type="text" placeholder="e.g. Sleeping bag" data-field="name" value="${escapeHtml(it.name)}" required>
              </div>
              <div class="edit-row">
                <div class="edit-section" style="flex:1">
                  <label>Brand</label>
                  <input class="edit-field" type="text" placeholder="e.g. Marmot" data-field="brand" value="${escapeHtml(it.brand||'')}" list="inline-brand-list-${it.id}">
                </div>
                <div class="edit-section" style="flex:1">
                  <label>Model</label>
                  <input class="edit-field" type="text" placeholder="e.g. Trestles 30" data-field="model" value="${escapeHtml(it.model||'')}" list="inline-model-list-${it.id}">
                </div>
              </div>
              <div class="edit-section" style="display:flex;align-items:center;gap:10px;flex-direction:row">
                <label style="margin:0;font-size:10px;white-space:nowrap">Level of satisfaction</label>
                <div class="star-rating-inline" data-id="${it.id}">
                  ${[5,4,3,2,1].map(val => `
                    <input type="radio" id="star${val}-${it.id}" name="rating-${it.id}" value="${val}" ${it.rating === val ? 'checked' : ''}>
                    <label for="star${val}-${it.id}" title="${val} star${val>1?'s':''}">★</label>
                  `).join('')}
                </div>
              </div>
              <div class="edit-row">
                <div class="edit-section" style="flex:1">
                  <label>Weight (g)</label>
                  <input class="edit-field" type="number" placeholder="in grams" data-field="weight" value="${it.weight}" min="0" step="1">
                </div>
                <div class="edit-section" style="flex:1">
                  <label>Price (₽)</label>
                  <input class="edit-field" type="number" placeholder="in RUB" data-field="price" value="${it.price||''}" min="0" step="0.01">
                </div>
                <div class="edit-section" style="flex:1">
                  <label>Year of purchase</label>
                  <input class="edit-field" type="number" placeholder="Year" data-field="year" value="${it.year||''}" min="1900" max="2100" step="1">
                </div>
              </div>
              <div class="edit-section">
                <select class="edit-field" data-field="category" style="text-transform:uppercase;font-size:11px;letter-spacing:0.5px;font-weight:500;padding:10px;">
                  <option value="">— No Category —</option>
                  <option value="Shelter" ${it.category==='Shelter'?'selected':''}>Shelter</option>
                  <option value="Sleep System" ${it.category==='Sleep System'?'selected':''}>Sleep System</option>
                  <option value="Camp Furniture" ${it.category==='Camp Furniture'||it.category==='Furniture'?'selected':''}>Camp Furniture</option>
                  <option value="Clothing" ${it.category==='Clothing'?'selected':''}>Clothing</option>
                  <option value="Footwear" ${it.category==='Footwear'?'selected':''}>Footwear</option>
                  <option value="Packs & Bags" ${it.category==='Packs & Bags'?'selected':''}>Packs & Bags</option>
                  <option value="Cooking" ${it.category==='Cooking'||it.category==='Kitchen'?'selected':''}>Cooking</option>
                  <option value="Electronics" ${it.category==='Electronics'||it.category==='Electronic'?'selected':''}>Electronics</option>
                  <option value="Lighting" ${it.category==='Lighting'?'selected':''}>Lighting</option>
                  <option value="First Aid / Safety" ${it.category==='First Aid / Safety'?'selected':''}>First Aid / Safety</option>
                  <option value="Personal items / Documents" ${it.category==='Personal items / Documents'||it.category==='Personal items'?'selected':''}>Personal items / Documents</option>
                  <option value="Knives & Tools" ${it.category==='Knives & Tools'||it.category==='Tools'?'selected':''}>Knives & Tools</option>
                  <option value="Technical Gear" ${it.category==='Technical Gear'||it.category==='Equipment'?'selected':''}>Technical Gear</option>
                  <option value="Sports Equipment" ${it.category==='Sports Equipment'?'selected':''}>Sports Equipment</option>
                  <option value="Consumables" ${it.category==='Consumables'?'selected':''}>Consumables</option>
                </select>
              </div>
              <div class="edit-section">
                <label>Storage location</label>
                <div style="display:flex;gap:8px;align-items:center;">
                  <select class="edit-field" data-field="storageId" style="flex:1;">
                    <option value="">No storage specified</option>
                    ${storages.map(st => `<option value="${st.id}" ${it.storageId === st.id ? 'selected' : ''}>${escapeHtml(st.name)}</option>`).join('')}
                  </select>
                  <button type="button" class="btn icon create-storage-inline" data-item-id="${it.id}" title="Create new storage" style="flex-shrink:0;">
                    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width:18px;height:18px;">
                      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" fill="currentColor"/>
                    </svg>
                  </button>
                </div>
                <div class="storage-inline-form-edit" data-item-id="${it.id}" style="display:none;margin-top:8px;">
                  <div style="display:flex;gap:8px;">
                    <input type="text" class="edit-field new-storage-name-edit" placeholder="New storage name..." style="flex:1;">
                    <button type="button" class="btn primary save-storage-inline-edit" data-item-id="${it.id}" style="flex-shrink:0;">Save</button>
                    <button type="button" class="btn secondary cancel-storage-inline-edit" data-item-id="${it.id}" style="flex-shrink:0;">Cancel</button>
                  </div>
                </div>
              </div>
              <div class="edit-section">
                <label>Visibility</label>
                <div class="inline-visibility-picker" data-item-id="${it.id}"></div>
              </div>
              <div class="edit-section">
                <label>In Checklists</label>
                <div class="edit-checklists-container" style="max-height:200px;overflow-y:auto;padding:8px;background:rgba(255,255,255,0.05);border-radius:8px;">
                  ${checklists.filter(canEditResource).length === 0 ? '<p style="font-size:12px;color:#888;margin:0;">No editable checklists</p>' : checklists.filter(canEditResource).map(cl => `
                    <label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;">
                      <input type="checkbox" class="edit-checklist-checkbox" data-checklist-id="${cl.id}" data-item-id="${it.id}" ${cl.items.find(i => i.itemId === it.id) ? 'checked' : ''} style="cursor:pointer;width:18px;height:18px;">
                      <span style="font-size:13px;">${escapeHtml(cl.name)}</span>
                    </label>
                  `).join('')}
                </div>
                <button type="button" class="btn icon create-checklist-inline-edit" data-item-id="${it.id}" title="Create new checklist" style="margin-top:8px;width:100%;">
                  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width:18px;height:18px;margin-right:4px;">
                    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" fill="currentColor"/>
                  </svg>
                  Create new checklist
                </button>
                <div class="checklist-inline-form-edit" data-item-id="${it.id}" style="display:none;margin-top:8px;">
                  <div style="display:flex;gap:8px;">
                    <input type="text" class="edit-field new-checklist-name-edit" placeholder="New checklist name..." style="flex:1;">
                    <button type="button" class="btn primary save-checklist-inline-edit" data-item-id="${it.id}" style="flex-shrink:0;">Save</button>
                    <button type="button" class="btn secondary cancel-checklist-inline-edit" data-item-id="${it.id}" style="flex-shrink:0;">Cancel</button>
                  </div>
                </div>
              </div>
              <div class="edit-section">
                <label>Comment</label>
                <textarea class="edit-field" placeholder="Short note..." data-field="comment" rows="2" maxlength="200">${escapeHtml(it.comment||'')}</textarea>
              </div>
              <div class="edit-actions">
                <button class="btn primary save-edit" data-id="${it.id}" aria-label="Save">Save</button>
                <button class="btn cancel-edit" data-id="${it.id}" aria-label="Cancel">Cancel</button>
              </div>
            </div>
          </div>`
        fragment.appendChild(el)
    })

    // Append uncategorized items fragment
    if (fragment.children.length > 0) {
      cardsEl.appendChild(fragment)
    }

    // Render categories
    const categoryFragment = document.createDocumentFragment()

    // Render non-empty sections first; optional empty sections stay at the bottom.
    const renderCategories = appHelpers.getRenderableGearCategories(allCategories, grouped, showEmptyGearCategories)
    renderCategories.forEach(catName=>{
      const catItems = grouped[catName] || []
      const catCount = catItems.length
      // Use cached stats or compute if not cached
      const cacheKey = `${catName}_${catItems.map(i => i.id).join(',')}`
      if (!statsCache[cacheKey]) {
        statsCache[cacheKey] = {
          weight: catItems.reduce((s,i)=>s + (Number(i.weight)||0), 0),
          price: catItems.reduce((s,i)=>s + (Number(i.price)||0), 0)
        }
      }
      const catWeight = statsCache[cacheKey].weight
      const catPrice = statsCache[cacheKey].price

      // Create category section wrapper
      const catSection = document.createElement('div')
      catSection.className = catCount === 0 ? 'category-section empty' : 'category-section'
      catSection.dataset.category = catName

      // Create category header
      const catHeader = document.createElement('div')
      catHeader.className = 'category-header'
      catHeader.dataset.category = catName
      catHeader.innerHTML = `
        <div class="category-left">
          <button class="category-toggle" data-action="toggle-category-group" data-category="${escapeHtml(catName)}" aria-label="Toggle ${escapeHtml(catName)}">
            <span class="cat-title">${escapeHtml(catName)}</span>
            <svg class="cat-chevron" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="transform:rotate(180deg)">
              <path d="M7 14l5-5 5 5z"/>
            </svg>
          </button>
        </div>
        <div class="category-controls">
          ${catCount > 0 ? `
          <div class="category-sort-wrapper" data-category="${escapeHtml(catName)}">
            <button class="category-sort-order-btn" data-category="${escapeHtml(catName)}" data-order="asc" title="Toggle sort order" aria-label="Toggle sort order">
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" class="icon-asc">
                <path d="M3 6h6v2H3V6zm0 12v-2h18v2H3zm0-7h12v2H3v-2z"/>
              </svg>
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" class="icon-desc" style="display:none">
                <path d="M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z"/>
              </svg>
            </button>
            <button class="category-sort-type-btn" data-category="${escapeHtml(catName)}" title="Choose sort type" aria-label="Choose sort type">
              <span class="sort-label">Name</span>
            </button>
            <select class="category-sort-select" data-category="${escapeHtml(catName)}">
              <option value="name" selected>Name</option>
              <option value="weight">Weight</option>
              <option value="price">Price</option>
              <option value="year">Year</option>
              <option value="rating">Rating</option>
            </select>
          </div>
          ` : ''}
          <div class="category-stats">
            <span class="stat">${catCount}</span>
            <span class="stat">${formatWeight(catWeight)}</span>
            <span class="stat">${formatPrice(catPrice)}</span>
          </div>
        </div>
      `

      // Provide move up/down controls instead of drag-and-drop
      // (drag handlers removed to simplify behavior and improve performance)

      // Set correct chevron rotation based on collapsed state
      const shouldBeCollapsed = appHelpers.shouldCollapseCategory(catCount, collapsedStates, catName)
      const chevron = catHeader.querySelector('.cat-chevron')
      if (chevron) {
        chevron.style.transform = shouldBeCollapsed ? 'rotate(180deg)' : 'rotate(0deg)'
      }

      // Add catHeader to section
      catSection.appendChild(catHeader)

      // Make clicking anywhere on the category header toggle collapse/expand
      catHeader.addEventListener('click', (e) => {
        // Ignore clicks on interactive controls inside header
        if (e.target.closest('button') || e.target.closest('select') || e.target.closest('input') || e.target.closest('a')) return
        const toggleBtn = catHeader.querySelector('.category-toggle')
        if (toggleBtn) {
          toggleBtn.click()
        }
      })

      // Create items container
      const itemsContainer = document.createElement('div')
      const isCollapsed = appHelpers.shouldCollapseCategory(catCount, collapsedStates, catName)
      itemsContainer.className = isCollapsed ? 'category-items collapsed' : 'category-items'
      itemsContainer.dataset.category = catName
      itemsContainer.addEventListener('click', ()=> {}, true) // For event bubbling control

      // Force name mode if not set
      if (!categorySortMode[catName]) {
        categorySortMode[catName] = 'name'
      }

      // Set current sort mode for this category
      const currentMode = categorySortMode[catName] || 'name'
      const sortSelect = catSection.querySelector('.category-sort-select')
      const sortLabel = catSection.querySelector('.sort-label')
      const sortOrderBtn = catSection.querySelector('.category-sort-order-btn')
      if (sortSelect) {
        sortSelect.value = currentMode
      }
      if (sortLabel) {
        const sortLabels = {name: 'Name', weight: 'Weight', price: 'Price', year: 'Year', rating: 'Rating'}
        sortLabel.textContent = sortLabels[currentMode] || 'Name'
      }
      // Always show sort order button
      if (sortOrderBtn) {
        sortOrderBtn.style.display = 'inline-flex'
      }

      // Render each item in category
      catItems.forEach(it=>{
        const el = document.createElement('article')
        el.className = 'card'
        el.dataset.id = it.id
        const imgHtml = it.image ? `<img class=\"thumb\" src=\"${it.image}\" alt=\"${escapeHtml(it.name)}\">` : ''

        // Find checklists that contain this item
        const itemChecklists = checklists.filter(cl => cl.items.some(ci => ci.itemId === it.id))
        const checklistBadgesHtml = itemChecklists.length > 0
          ? `<div class=\"card-checklists\">${itemChecklists.map(cl => `<span class=\"checklist-badge\" title=\"${escapeHtml(cl.name)}\">${escapeHtml(cl.name)}</span>`).join('')}</div>`
          : ''

        const storageName = it.storageId ? storages.find(s => s.id === it.storageId)?.name : null
        const storageBadgeHtml = storageName ? `<span class=\"storage-badge\" title=\"Storage: ${escapeHtml(storageName)}\">${escapeHtml(storageName)}</span>` : ''
        const commentIconHtml = it.comment ? `<svg class=\"comment-icon\" viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\" title=\"Has comment\"><path d=\"M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z\" fill=\"currentColor\"/></svg>` : ''

        el.innerHTML = `
          <div class=\"card-compact-content\">
            ${imgHtml}
            <div class=\"left\">
              <div class=\"card-header\">
                <h3 title=\"${escapeHtml(it.name)}\">${escapeHtml(it.name)}</h3>
                ${commentIconHtml}
                ${storageBadgeHtml}
                ${renderVisibilityBadges(it)}
                <div class=\"weight-badge\">${formatWeight(it.weight)}</div>
              </div>
              <div class=\"card-footer\">
                <div class=\"attrs\">
                  <span>${escapeHtml(it.brand||'-')}</span>
                  <span>${escapeHtml(it.model||'-')}</span>
                </div>
                <div class=\"card-price-section\">
                  ${it.rating ? `<span class=\"rating-display\">${'★'.repeat(it.rating)}${'☆'.repeat(5-it.rating)}</span>` : `<span class=\"rating-display\"></span>`}
                  ${it.year ? `<span class=\"year-badge\">${it.year}</span>` : ''}
                  <div class=\"price-badge\">${it.price ? formatPrice(it.price) : '-'}</div>
                </div>
              </div>
            </div>
            <div class=\"right\">
              <div class=\"actions\">
                <button class=\"btn icon edit\" data-action=\"edit\" data-id=\"${it.id}\" aria-label=\"Edit\">
                  <svg viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\">
                    <path d=\"M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z\"/>
                  </svg>
                </button>
                <button class=\"btn icon delete delete-edit\" data-id=\"${it.id}\" aria-label=\"Delete\" style=\"display: none;\">
                  <svg viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\">
                    <path d=\"M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z\"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
          <div class=\"card-expanded-content\">
            <div class=\"card-expanded-header\">
              <div class=\"card-expanded-photo\">
                <div class=\"photo-container\" data-id=\"${it.id}\">${it.image ? `<img src=\"${it.image}\" alt=\"${escapeHtml(it.name)}\">` : 'No photo'}
                  <input class=\"edit-field photo-file-input\" type=\"file\" accept=\"image/*\" data-field=\"photo\" data-id=\"${it.id}\" style=\"display: none;\">
                  <div class=\"photo-overlay-buttons\">
                    <button class=\"photo-overlay-btn\" data-action=\"replace-photo\" data-id=\"${it.id}\" title=\"Replace photo\">
                      <svg viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\">
                        <path d=\"M19 12v7H5v-7M12 2.5l3.5 3.5L12 9.5 8.5 6z\"/>
                        <path d=\"M12 9v9\"/>
                      </svg>
                    </button>
                    <button class=\"photo-overlay-btn\" data-action=\"add-photo\" data-id=\"${it.id}\" title=\"Add photo\" style=\"${it.image ? 'display: none;' : ''}\">
                      <svg viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\">
                        <path d=\"M19 7v2.99s-1.99.01-2 0V7h-3s.01-1.99 0-2h3V2h2v3h3v2h-3zm-3 4V9h-3V7H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-8h-3zM5 19l3-4 2 3 3-4 4 5H5z\"/>
                      </svg>
                    </button>
                    <button class=\"photo-overlay-btn\" data-action=\"remove-photo\" data-id=\"${it.id}\" title=\"Remove photo\" style=\"${it.image ? '' : 'display: none;'}\">
                      <svg viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\">
                        <path d=\"M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z\"/>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
              <div class=\"card-expanded-info\">
                <h3 class=\"card-expanded-title\">${escapeHtml(it.name)}</h3>
                ${it.brand ? `<div class=\"card-expanded-brand\">${escapeHtml(it.brand)} ${it.model ? escapeHtml(it.model) : ''}</div>` : ''}
                <div class=\"card-expanded-details\">
                  <div class=\"card-expanded-detail weight-detail\">
                    <div class=\"card-expanded-detail-label\">Weight</div>
                    <div class=\"card-expanded-detail-value weight-value\">${formatWeight(it.weight)}</div>
                  </div>
                  ${it.price ? `
                  <div class=\"card-expanded-detail\">
                    <div class=\"card-expanded-detail-label\">Price</div>
                    <div class=\"card-expanded-detail-value\">${formatPrice(it.price)}</div>
                  </div>` : ''}
                  ${it.year ? `
                  <div class=\"card-expanded-detail\">
                    <div class=\"card-expanded-detail-label\">Year of purchase</div>
                    <div class=\"card-expanded-detail-value\">${it.year}</div>
                  </div>` : ''}
                  ${it.rating ? `
                  <div class=\"card-expanded-detail\">
                    <div class=\"card-expanded-detail-label\">Level of satisfaction</div>
                    <div class=\"card-expanded-detail-value\">${'★'.repeat(it.rating)}${'☆'.repeat(5-it.rating)}</div>
                  </div>` : ''}
                </div>
                ${checklistBadgesHtml}
                ${it.comment ? `
                <div class=\"card-comment\">
                  <div class=\"card-comment-label\">Comment</div>
                  <div class=\"card-comment-value\">${escapeHtml(it.comment)}</div>
                </div>` : ''}
              </div>
            </div>
            <div class=\"right\">
              <div class=\"actions\">
                ${storageBadgeHtml}
                ${renderVisibilityBadges(it)}
                <button class=\"btn icon share\" data-action=\"share\" data-id=\"${it.id}\" aria-label=\"Share\" title=\"Share item\">
                  <svg viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\">
                    <circle cx=\"18\" cy=\"5\" r=\"3\"/>
                    <circle cx=\"6\" cy=\"12\" r=\"3\"/>
                    <circle cx=\"18\" cy=\"19\" r=\"3\"/>
                    <path d=\"M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98\" stroke=\"currentColor\" stroke-width=\"1.5\" fill=\"none\"/>
                  </svg>
                </button>
                <button class=\"btn icon edit\" data-action=\"edit\" data-id=\"${it.id}\" aria-label=\"Edit\">
                  <svg viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\">
                    <path d=\"M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z\"/>
                  </svg>
                </button>
                <button class=\"btn icon delete delete-edit\" data-id=\"${it.id}\" aria-label=\"Delete\" style=\"display: none;\">
                  <svg viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\">
                    <path d=\"M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z\"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
          <div class=\"card-edit-form hidden\">
            <div class=\"edit-fields\">
              <div class=\"edit-section\">
                <label>Name *</label>
                <input class=\"edit-field\" type=\"text\" placeholder=\"e.g. Sleeping bag\" data-field=\"name\" value=\"${escapeHtml(it.name)}\" required>
              </div>
              <div class=\"edit-row\">
                <div class=\"edit-section\" style=\"flex:1\">
                  <label>Brand</label>
                  <input class=\"edit-field\" type=\"text\" placeholder=\"e.g. Marmot\" data-field=\"brand\" value=\"${escapeHtml(it.brand||'')}\" list=\"inline-brand-list-${it.id}\">
                </div>
                <div class=\"edit-section\" style=\"flex:1\">
                  <label>Model</label>
                  <input class=\"edit-field\" type=\"text\" placeholder=\"e.g. Trestles 30\" data-field=\"model\" value=\"${escapeHtml(it.model||'')}\" list=\"inline-model-list-${it.id}\">
                </div>
              </div>
              <div class=\"edit-section\" style=\"display:flex;align-items:center;gap:10px;flex-direction:row\">
                <label style=\"margin:0;font-size:10px;white-space:nowrap\">Level of satisfaction</label>
                <div class=\"star-rating-inline\" data-id=\"${it.id}\">${[5,4,3,2,1].map(val => `
                    <input type=\"radio\" id=\"star${val}-${it.id}\" name=\"rating-${it.id}\" value=\"${val}\" ${it.rating === val ? 'checked' : ''}>
                    <label for=\"star${val}-${it.id}\" title=\"${val} star${val>1?'s':''}\">★</label>
                  `).join('')}
                </div>
              </div>
              <div class=\"edit-row\">
                <div class=\"edit-section\" style=\"flex:1\">
                  <label>Weight (g)</label>
                  <input class=\"edit-field\" type=\"number\" placeholder=\"in grams\" data-field=\"weight\" value=\"${it.weight}\" min=\"0\" step=\"1\">
                </div>
                <div class=\"edit-section\" style=\"flex:1\">
                  <label>Price (₽)</label>
                  <input class=\"edit-field\" type=\"number\" placeholder=\"in RUB\" data-field=\"price\" value=\"${it.price||''}\" min=\"0\" step=\"0.01\">
                </div>
                <div class=\"edit-section\" style=\"flex:1\">
                  <label>Year of purchase</label>
                  <input class=\"edit-field\" type=\"number\" placeholder=\"2024\" data-field=\"year\" value=\"${it.year||''}\" min=\"1900\" max=\"2100\" step=\"1\">
                </div>
              </div>
              <div class=\"edit-section\">
                <label>Category</label>
                <select class=\"edit-field\" data-field=\"category\">
                  <option value=\"\">— No Category —</option>
                  <option value=\"Shelter\" ${it.category==='Shelter'?'selected':''}>Shelter</option>
                  <option value=\"Sleep System\" ${it.category==='Sleep System'?'selected':''}>Sleep System</option>
                  <option value=\"Camp Furniture\" ${it.category==='Camp Furniture'||it.category==='Furniture'?'selected':''}>Camp Furniture</option>
                  <option value=\"Clothing\" ${it.category==='Clothing'?'selected':''}>Clothing</option>
                  <option value=\"Footwear\" ${it.category==='Footwear'?'selected':''}>Footwear</option>
                  <option value=\"Packs & Bags\" ${it.category==='Packs & Bags'?'selected':''}>Packs & Bags</option>
                  <option value=\"Cooking\" ${it.category==='Cooking'||it.category==='Kitchen'?'selected':''}>Cooking</option>
                  <option value=\"Electronics\" ${it.category==='Electronics'||it.category==='Electronic'?'selected':''}>Electronics</option>
                  <option value=\"Lighting\" ${it.category==='Lighting'?'selected':''}>Lighting</option>
                  <option value=\"First Aid / Safety\" ${it.category==='First Aid / Safety'?'selected':''}>First Aid / Safety</option>
                  <option value=\"Personal items / Documents\" ${it.category==='Personal items / Documents'||it.category==='Personal items'?'selected':''}>Personal items / Documents</option>
                  <option value=\"Knives & Tools\" ${it.category==='Knives & Tools'||it.category==='Tools'?'selected':''}>Knives & Tools</option>
                  <option value=\"Technical Gear\" ${it.category==='Technical Gear'||it.category==='Equipment'?'selected':''}>Technical Gear</option>
                  <option value=\"Sports Equipment\" ${it.category==='Sports Equipment'?'selected':''}>Sports Equipment</option>
                  <option value=\"Consumables\" ${it.category==='Consumables'?'selected':''}>Consumables</option>
                </select>
              </div>
              <div class=\"edit-section\">
                <label>Storage location</label>
                <div style=\"display:flex;gap:8px;align-items:center;\">
                  <select class=\"edit-field\" data-field=\"storageId\" style=\"flex:1;\">
                    <option value=\"\">No storage specified</option>
                    ${storages.map(st => `<option value=\"${st.id}\" ${it.storageId === st.id ? 'selected' : ''}>${escapeHtml(st.name)}</option>`).join('')}
                  </select>
                  <button type=\"button\" class=\"btn icon create-storage-inline\" data-item-id=\"${it.id}\" title=\"Create new storage\" style=\"flex-shrink:0;\">
                    <svg viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\" style=\"width:18px;height:18px;\">
                      <path d=\"M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z\" fill=\"currentColor\"/>
                    </svg>
                  </button>
                </div>
                <div class=\"storage-inline-form-edit\" data-item-id=\"${it.id}\" style=\"display:none;margin-top:8px;\">
                  <div style=\"display:flex;gap:8px;\">
                    <input type=\"text\" class=\"edit-field new-storage-name-edit\" placeholder=\"New storage name...\" style=\"flex:1;\">
                    <button type=\"button\" class=\"btn primary save-storage-inline-edit\" data-item-id=\"${it.id}\" style=\"flex-shrink:0;\">Save</button>
                    <button type=\"button\" class=\"btn secondary cancel-storage-inline-edit\" data-item-id=\"${it.id}\" style=\"flex-shrink:0;\">Cancel</button>
                  </div>
                </div>
              </div>
              <div class=\"edit-section\">
                <label>Visibility</label>
                <div class=\"inline-visibility-picker\" data-item-id=\"${it.id}\"></div>
              </div>
              <div class=\"edit-section\">
                <label>In Checklists</label>
                <div class=\"edit-checklists-container\" style=\"max-height:200px;overflow-y:auto;padding:8px;background:rgba(255,255,255,0.05);border-radius:8px;\">
                  ${checklists.filter(canEditResource).length === 0 ? '<p style=\"font-size:12px;color:#888;margin:0;\">No editable checklists</p>' : checklists.filter(canEditResource).map(cl => `
                    <label style=\"display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;\">
                      <input type=\"checkbox\" class=\"edit-checklist-checkbox\" data-checklist-id=\"${cl.id}\" data-item-id=\"${it.id}\" ${cl.items.find(i => i.itemId === it.id) ? 'checked' : ''} style=\"cursor:pointer;width:18px;height:18px;\">
                      <span style=\"font-size:13px;\">${escapeHtml(cl.name)}</span>
                    </label>
                  `).join('')}
                </div>
                <button type=\"button\" class=\"btn icon create-checklist-inline-edit\" data-item-id=\"${it.id}\" title=\"Create new checklist\" style=\"margin-top:8px;width:100%;\">
                  <svg viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\" style=\"width:18px;height:18px;margin-right:4px;\">
                    <path d=\"M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z\" fill=\"currentColor\"/>
                  </svg>
                  Create new checklist
                </button>
                <div class=\"checklist-inline-form-edit\" data-item-id=\"${it.id}\" style=\"display:none;margin-top:8px;\">
                  <div style=\"display:flex;gap:8px;\">
                    <input type=\"text\" class=\"edit-field new-checklist-name-edit\" placeholder=\"New checklist name...\" style=\"flex:1;\">
                    <button type=\"button\" class=\"btn primary save-checklist-inline-edit\" data-item-id=\"${it.id}\" style=\"flex-shrink:0;\">Save</button>
                    <button type=\"button\" class=\"btn secondary cancel-checklist-inline-edit\" data-item-id=\"${it.id}\" style=\"flex-shrink:0;\">Cancel</button>
                  </div>
                </div>
              </div>
              <div class=\"edit-section\">
                <label>Comment</label>
                <textarea class=\"edit-field\" placeholder=\"Short note...\" data-field=\"comment\" rows=\"2\" maxlength=\"200\">${escapeHtml(it.comment||'')}</textarea>
              </div>
              <div class=\"edit-actions\">
                <button class=\"btn primary save-edit\" data-id=\"${it.id}\" aria-label=\"Save\">Save</button>
                <button class=\"btn cancel-edit\" data-id=\"${it.id}\" aria-label=\"Cancel\">Cancel</button>
              </div>
            </div>
          </div>`
        itemsContainer.appendChild(el)
      })

      catSection.appendChild(itemsContainer)
      categoryFragment.appendChild(catSection)
    })

    // Append all categories at once
    cardsEl.appendChild(categoryFragment)

    // Insert category-order toolbar above the first category (single control)
    const _firstCategory = cardsEl.querySelector('.category-section')
    const _toolbarAnchor = _firstCategory || cardsEl.firstElementChild
    {
      const toolbar = document.createElement('div')
      toolbar.className = 'category-order-toolbar'
      toolbar.innerHTML = `
        <div class="toolbar-search-wrapper">
          <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.35-4.35"/>
          </svg>
          <input id="search" type="search" placeholder="Search gear...">
        </div>
        <div class="toolbar-storage-controls" style="display:${storages.length > 0 ? 'flex' : 'none'}">
          <span class="toolbar-storage-label">Storages</span>
          <div class="toolbar-storage-filter" id="toolbarStorageFilter">
            <button type="button" class="toolbar-storage-filter-toggle" aria-haspopup="true" aria-expanded="false">
              <span>${escapeHtml(appHelpers.getStorageFilterLabel(currentStorageFilters, storages))}</span>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 10l5 5 5-5z"/>
              </svg>
            </button>
            <div class="toolbar-storage-filter-menu">
              <button type="button" class="toolbar-storage-clear" data-action="clear-storage-filter">All storages</button>
              ${storages.map(st => {
                const checked = currentStorageFilters.includes(st.id) ? 'checked' : ''
                return `
                  <label class="toolbar-storage-option">
                    <input type="checkbox" value="${escapeHtml(st.id)}" ${checked}>
                    <span>${escapeHtml(st.name)}</span>
                  </label>
                `
              }).join('')}
            </div>
          </div>
          <button class="toolbar-storage-btn" id="toolbarManageStorages" title="Manage storages">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
            </svg>
          </button>
        </div>
        <div class="toolbar-storage-controls">
          <span class="toolbar-storage-label">Visibility</span>
          <select id="visibleSearchScope" class="toolbar-storage-select">
            <option value="mine" ${visibleSearchScope === 'mine' ? 'selected' : ''}>Mine</option>
            <option value="all_visible" ${visibleSearchScope === 'all_visible' ? 'selected' : ''}>All visible</option>
            <option value="public" ${visibleSearchScope === 'public' ? 'selected' : ''}>Public</option>
            <option value="shared" ${visibleSearchScope === 'shared' ? 'selected' : ''}>Shared with me</option>
          </select>
          <button class="toolbar-storage-btn" id="refreshVisibleSearch" title="Refresh visible search" aria-label="Refresh visible search">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M20 6v5h-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M19 11a7 7 0 1 0-2.05 4.95" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
        <div class="category-order-toolbar-inner">
          <label class="toolbar-checkbox-control show-empty-control">
            <input id="showEmptyGearCategories" type="checkbox" ${showEmptyGearCategories ? 'checked' : ''}>
            <span>Show Empty</span>
          </label>
          <button class="category-edit-order-btn" title="Edit category order" aria-label="Edit category order">
            <svg width="18" height="12" viewBox="0 0 18 12" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M2 2h14M2 6h14M2 10h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>
            </svg>
          </button>
          <button class="category-toggle-all-btn" title="Toggle all categories" aria-label="Toggle all categories">
            <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M12 5l4 4H8l4-4zm0 14l-4-4h8l-4 4z" fill="currentColor"/>
            </svg>
          </button>
        </div>`
      cardsEl.insertBefore(toolbar, _toolbarAnchor)

      // Setup search functionality
      const searchInput = toolbar.querySelector('#search')
      if (searchInput) {
        // Restore search value, cursor position and focus after re-render
        if (searchRawValue) {
          searchInput.value = searchRawValue
          // Set cursor at the end of the text
          searchInput.setSelectionRange(searchRawValue.length, searchRawValue.length)
        }
        if (searchWasFocused) {
          searchInput.focus()
        }

        let searchTimer = null
        searchInput.addEventListener('input', () => {
          clearTimeout(searchTimer)
          searchTimer = setTimeout(render, 300)
        })
        // Handle clearing search via X button in type="search"
        searchInput.addEventListener('search', () => {
          render()
        })
      }

      const showEmptyCheckbox = toolbar.querySelector('#showEmptyGearCategories')
      if (showEmptyCheckbox) {
        showEmptyCheckbox.addEventListener('change', (e) => {
          showEmptyGearCategories = e.target.checked
          render()
        })
      }

      // Setup toolbar storage controls
      const toolbarStorageFilter = toolbar.querySelector('#toolbarStorageFilter')
      if (toolbarStorageFilter) {
        const toggle = toolbarStorageFilter.querySelector('.toolbar-storage-filter-toggle')
        const menu = toolbarStorageFilter.querySelector('.toolbar-storage-filter-menu')
        toggle?.addEventListener('click', (e) => {
          e.stopPropagation()
          const isOpen = toolbarStorageFilter.classList.toggle('open')
          toggle.setAttribute('aria-expanded', String(isOpen))
        })
        menu?.addEventListener('click', (e) => {
          e.stopPropagation()
        })
        menu?.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
          checkbox.addEventListener('change', () => {
            currentStorageFilters = Array.from(menu.querySelectorAll('input[type="checkbox"]:checked'))
              .map(input => input.value)
              .filter(Boolean)
            render()
          })
        })
        const clearStorageFilter = menu?.querySelector('[data-action="clear-storage-filter"]')
        clearStorageFilter?.addEventListener('click', () => {
          currentStorageFilters = []
          render()
        })
      }

      const toolbarManageStorages = toolbar.querySelector('#toolbarManageStorages')
      if (toolbarManageStorages) {
        toolbarManageStorages.addEventListener('click', openManageStoragesModal)
      }

      const visibleScopeSelect = toolbar.querySelector('#visibleSearchScope')
      const refreshVisibleSearch = toolbar.querySelector('#refreshVisibleSearch')
      const runVisibleSearch = async () => {
        visibleSearchScope = visibleScopeSelect?.value || 'mine'
        if (visibleSearchScope === 'mine') {
          visibleSearchResults = null
          render()
          return
        }

        try {
          visibleSearchResults = await SupabaseService.searchVisibleGear(searchInput?.value || '', {
            scope: visibleSearchScope,
            limit: 50
          })
          render()
        } catch (err) {
          console.error('Visible gear search failed:', err)
          alert('Visible search failed: ' + err.message)
        }
      }
      if (visibleScopeSelect) {
        visibleScopeSelect.addEventListener('change', runVisibleSearch)
      }
      if (refreshVisibleSearch) {
        refreshVisibleSearch.addEventListener('click', runVisibleSearch)
      }

      const btn = toolbar.querySelector('.category-edit-order-btn')
      if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); openCategoryOrderModal() })

      const toggleAllBtn = toolbar.querySelector('.category-toggle-all-btn')
      function toggleAllCategories(){
        const containers = Array.from(document.querySelectorAll('.category-items'))
        if(containers.length === 0) return
        const anyOpen = containers.some(c => !c.classList.contains('collapsed'))
        containers.forEach(c => {
          const header = c.previousElementSibling
          if(anyOpen){
            c.classList.add('collapsed')
            if(header){
              const chevron = header.querySelector('.cat-chevron')
              if(chevron) chevron.style.transform = 'rotate(180deg)'
            }
          } else {
            c.classList.remove('collapsed')
            if(header){
              const chevron = header.querySelector('.cat-chevron')
              if(chevron) chevron.style.transform = 'rotate(0deg)'
            }
          }
        })
      }
      if(toggleAllBtn) toggleAllBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleAllCategories() })
    }

    document.querySelectorAll('.card[data-id]').forEach(card => {
      const item = renderItems.find(it => it.id === card.dataset.id)
      if (item && !canEditResource(item)) {
        card.querySelectorAll('[data-action="edit"], [data-action="delete"], [data-action="add-photo"], [data-action="replace-photo"], [data-action="remove-photo"], .delete-edit, .photo-action-btn').forEach(el => el.remove())
        const editForm = card.querySelector('.card-edit-form')
        if (editForm) editForm.remove()
      }
    })

    // Create datalists for inline editing
    createInlineDataLists()

    // stats
    const totalCount = renderItems.length
    const totalWeight = renderItems.reduce((s,i)=>s + (Number(i.weight)||0),0)
    const totalPrice = renderItems.reduce((s,i)=>s + (Number(i.price)||0),0)
    countEl.textContent = totalCount
    if(totalWeightEl) totalWeightEl.textContent = formatWeight(totalWeight)
    totalPriceEl.textContent = Number(totalPrice).toLocaleString('en-US', {maximumFractionDigits:2})
  }

  function updateTotals(){
    const totalCount = items.length
    const totalPrice = items.reduce((s,i)=>s + (Number(i.price)||0),0)
    countEl.textContent = totalCount
    totalPriceEl.textContent = Number(totalPrice).toLocaleString('en-US', {maximumFractionDigits:2})
  }

  // Memoization cache for formatters
  const formatCache = new Map()

  function formatWeight(w){
    const key = `w_${w}`
    if (formatCache.has(key)) return formatCache.get(key)

    let result
    if(w >= 1000){
      const kg = w / 1000
      if(kg >= 10){
        result = kg.toFixed(1) + ' kg'
      } else {
        result = kg.toFixed(2) + ' kg'
      }
    } else {
      result = w + ' g'
    }

    formatCache.set(key, result)
    return result
  }

  function formatPrice(v){
    const key = `p_${v}`
    if (formatCache.has(key)) return formatCache.get(key)

    const result = Number(v).toLocaleString('en-US', {maximumFractionDigits:2}) + ' ₽'
    formatCache.set(key, result)
    return result
  }

  function escapeHtml(s){
    if(!s) return ''
    return String(s).replace(/[&<>"']/g, c=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"
    }[c]))
  }

  // Storage management functions
  function populateStorageDropdown() {
    if (!storageSelect) return

    // Clear existing options except the first one
    storageSelect.innerHTML = '<option value="">No storage specified</option>'

    // Add all storages
    storages.forEach(storage => {
      const option = document.createElement('option')
      option.value = storage.id
      option.textContent = storage.name
      storageSelect.appendChild(option)
    })
  }

  function openCreateStorageModal() {
    const createModal = document.getElementById('createStorageModal')
    const storageNameInput = document.getElementById('storageNameInput')

    if (!createModal || !storageNameInput) return

    // Clear input
    storageNameInput.value = ''

    // Show modal
    createModal.classList.remove('hidden')

    // Focus input
    setTimeout(() => storageNameInput.focus(), 100)
  }

  async function createNewStorage() {
    const storageNameInput = document.getElementById('storageNameInput')
    const storageAddressInput = document.getElementById('storageAddressInput')
    const storageDescriptionInput = document.getElementById('storageDescriptionInput')
    const storageRatingInput = document.getElementById('storageRatingInput')
    const name = storageNameInput.value.trim()

    if (!name) {
      alert('Please enter a storage name')
      return
    }

    try {
      const newStorage = await SupabaseService.createStorage({
        name,
        address: storageAddressInput?.value.trim() || '',
        description: storageDescriptionInput?.value.trim() || '',
        rating: storageRatingInput?.value ? Number(storageRatingInput.value) : 0,
        visibility: 'public'
      })
      storages.push(newStorage)
      storages.sort((a, b) => a.name.localeCompare(b.name))
      populateStorageDropdown()

      // Select the newly created storage
      if (storageSelect) {
        storageSelect.value = newStorage.id
      }
      if (storageAddressInput) storageAddressInput.value = ''
      if (storageDescriptionInput) storageDescriptionInput.value = ''
      if (storageRatingInput) storageRatingInput.value = '0'

      // Close modal
      const createModal = document.getElementById('createStorageModal')
      if (createModal) {
        createModal.classList.add('hidden')
      }

      render()
    } catch (err) {
      console.error('Error creating storage:', err)
      alert('Failed to create storage: ' + err.message)
    }
  }

  function openManageStoragesModal() {
    const manageModal = document.getElementById('manageStoragesModal')
    const storagesList = document.getElementById('storagesList')

    if (!storagesList) return

    // Clear and populate storages list
    storagesList.innerHTML = ''

    if (storages.length === 0) {
      storagesList.innerHTML = '<p style="text-align:center;color:var(--muted);padding:20px;">No storage locations yet.</p>'
    } else {
      storages.forEach(storage => {
        const itemCount = items.filter(it => it.storageId === storage.id).length
        const canEditStorage = canEditResource(storage)

        const storageItem = document.createElement('div')
        storageItem.className = 'storage-item'
        storageItem.innerHTML = `
          <div class="storage-item-info">
            <div class="storage-item-name">${escapeHtml(storage.name)} ${renderVisibilityBadges(storage)}</div>
            <div class="storage-item-count">${itemCount} item${itemCount !== 1 ? 's' : ''}${storage.address ? ` · ${escapeHtml(storage.address)}` : ''} · ${renderStorageRatingStars(storage.rating)}</div>
            ${storage.description ? `<div class="storage-item-count">${escapeHtml(storage.description)}</div>` : ''}
          </div>
          ${canEditStorage ? `<div class="storage-item-actions">
            <button class="btn icon edit-storage" data-id="${storage.id}" title="Edit">
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
              </svg>
            </button>
            <button class="btn icon delete-storage" data-id="${storage.id}" title="Delete">
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
              </svg>
            </button>
          </div>` : ''}
        `
        storagesList.appendChild(storageItem)
      })
    }

    manageModal.classList.remove('hidden')
  }

  let storageToEdit = null

  async function editStorage(storageId) {
    const storage = storages.find(s => s.id === storageId)
    if (!storage) return
    if (!canEditResource(storage)) {
      alertOwnerOnly('storage locations')
      return
    }

    // Store storage info for editing
    storageToEdit = storageId

    // Update modal content
    const editModal = document.getElementById('editStorageNameModal')
    const titleEl = document.getElementById('editStorageNameTitle')
    const nameInputEl = document.getElementById('editStorageNameInput')
    const addressInputEl = document.getElementById('editStorageAddressInput')
    const descriptionInputEl = document.getElementById('editStorageDescriptionInput')
    const ratingInputEl = document.getElementById('editStorageRatingInput')

    titleEl.textContent = `Edit "${storage.name}"`
    nameInputEl.value = storage.name || ''
    if (addressInputEl) addressInputEl.value = storage.address || ''
    if (descriptionInputEl) descriptionInputEl.value = storage.description || ''
    setStorageRatingValue(ratingInputEl, storage.rating || 0)

    // Show modal
    editModal.classList.remove('hidden')
    setTimeout(() => {
      nameInputEl.focus()
      nameInputEl.select()
    }, 100)
  }

  // Initialize edit storage name modal
  const editStorageNameModal = document.getElementById('editStorageNameModal')
  const editStorageNameInput = document.getElementById('editStorageNameInput')
  const editStorageAddressInput = document.getElementById('editStorageAddressInput')
  const editStorageDescriptionInput = document.getElementById('editStorageDescriptionInput')
  const editStorageRatingInput = document.getElementById('editStorageRatingInput')
  const confirmEditStorageNameBtn = document.getElementById('confirmEditStorageName')
  const cancelEditStorageNameBtn = document.getElementById('cancelEditStorageName')

  if (confirmEditStorageNameBtn) {
    confirmEditStorageNameBtn.addEventListener('click', async () => {
      if (!storageToEdit) return

      const updates = {
        name: editStorageNameInput.value.trim(),
        address: editStorageAddressInput?.value.trim() || '',
        description: editStorageDescriptionInput?.value.trim() || '',
        rating: editStorageRatingInput?.value ? Number(editStorageRatingInput.value) : 0
      }

      if (!updates.name) return

      const storage = storages.find(s => s.id === storageToEdit)
      if (!storage) {
        editStorageNameModal.classList.add('hidden')
        storageToEdit = null
        return
      }

      const storageId = storageToEdit
      storageToEdit = null

      try {
        confirmEditStorageNameBtn.disabled = true
        confirmEditStorageNameBtn.textContent = 'Saving...'

        const updatedStorage = await SupabaseService.updateStorage(storageId, updates)
        Object.assign(storage, updatedStorage)
        storages.sort((a, b) => a.name.localeCompare(b.name))
        populateStorageDropdown()
        openManageStoragesModal()
        render()
        renderChecklist()

        // Close modal
        editStorageNameModal.classList.add('hidden')
        confirmEditStorageNameBtn.disabled = false
        confirmEditStorageNameBtn.textContent = 'Save'
      } catch (err) {
        console.error('Error updating storage:', err)
        alert('Failed to update storage: ' + err.message)
        confirmEditStorageNameBtn.disabled = false
        confirmEditStorageNameBtn.textContent = 'Save'
      }
    })
  }

  if (cancelEditStorageNameBtn) {
    cancelEditStorageNameBtn.addEventListener('click', () => {
      editStorageNameModal.classList.add('hidden')
      storageToEdit = null
    })
  }

  if (editStorageNameModal) {
    editStorageNameModal.addEventListener('click', e => {
      if (e.target === editStorageNameModal) {
        editStorageNameModal.classList.add('hidden')
        storageToEdit = null
      }
    })
  }

  // Handle Enter key in edit storage name input
  if (editStorageNameInput) {
    editStorageNameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        confirmEditStorageNameBtn?.click()
      }
    })
  }

  async function deleteStorage(storageId) {
    const storage = storages.find(s => s.id === storageId)
    if (!storage) return
    if (!canEditResource(storage)) {
      alertOwnerOnly('storage locations')
      return
    }

    const itemCount = items.filter(it => it.storageId === storageId).length

    // Store storage ID for confirmation
    storageToDelete = storageId

    // Update modal content
    const confirmModal = document.getElementById('confirmDeleteStorageModal')
    const titleEl = document.getElementById('confirmDeleteStorageTitle')
    const messageEl = document.getElementById('confirmDeleteStorageMessage')

    titleEl.textContent = `Delete "${storage.name}"?`

    if (itemCount > 0) {
      messageEl.textContent = `${itemCount} item${itemCount !== 1 ? 's are' : ' is'} using this storage. They will be set to "No storage specified".`
    } else {
      messageEl.textContent = 'This storage location will be permanently deleted.'
    }

    // Show modal
    confirmModal.classList.remove('hidden')
  }

  let storageToDelete = null

  // Initialize confirm delete storage modal
  const confirmDeleteStorageModal = document.getElementById('confirmDeleteStorageModal')
  const confirmDeleteStorageBtn = document.getElementById('confirmDeleteStorage')
  const cancelDeleteStorageBtn = document.getElementById('cancelDeleteStorage')

  if (confirmDeleteStorageBtn) {
    confirmDeleteStorageBtn.addEventListener('click', async () => {
      if (!storageToDelete) return

      const storageId = storageToDelete
      storageToDelete = null

      try {
        confirmDeleteStorageBtn.disabled = true
        confirmDeleteStorageBtn.textContent = 'Deleting...'

        await SupabaseService.deleteStorage(storageId)

        // Remove from storages array
        const index = storages.findIndex(s => s.id === storageId)
        if (index !== -1) storages.splice(index, 1)

        // Update items that used this storage
        items.forEach(item => {
          if (item.storageId === storageId) {
            item.storageId = null
          }
        })

        // Remove deleted storage from the toolbar filters
        currentStorageFilters = currentStorageFilters.filter(id => id !== storageId)

        // Clear checklist filters
        Object.keys(currentChecklistStorageFilter).forEach(checklistId => {
          if (currentChecklistStorageFilter[checklistId] === storageId) {
            currentChecklistStorageFilter[checklistId] = null
          }
        })

        populateStorageDropdown()
        openManageStoragesModal()
        render()
        renderChecklist()

        // Close modal
        confirmDeleteStorageModal.classList.add('hidden')
        confirmDeleteStorageBtn.disabled = false
        confirmDeleteStorageBtn.textContent = 'Delete'
      } catch (err) {
        console.error('Error deleting storage:', err)
        alert('Failed to delete storage: ' + err.message)
        confirmDeleteStorageBtn.disabled = false
        confirmDeleteStorageBtn.textContent = 'Delete'
      }
    })
  }

  if (cancelDeleteStorageBtn) {
    cancelDeleteStorageBtn.addEventListener('click', () => {
      confirmDeleteStorageModal.classList.add('hidden')
      storageToDelete = null
    })
  }

  if (confirmDeleteStorageModal) {
    confirmDeleteStorageModal.addEventListener('click', e => {
      if (e.target === confirmDeleteStorageModal) {
        confirmDeleteStorageModal.classList.add('hidden')
        storageToDelete = null
      }
    })
  }

  // Create datalists for inline editing
  function createInlineDataLists() {
    // Remove old inline datalists
    document.querySelectorAll('[id^="inline-brand-list-"], [id^="inline-model-list-"]').forEach(el => el.remove())

    // Create brand and model datalists for each item
    items.forEach(it => {
      // Brand datalist
      const brandList = document.createElement('datalist')
      brandList.id = `inline-brand-list-${it.id}`
      outdoorBrands.forEach(brand => {
        const option = document.createElement('option')
        option.value = brand
        brandList.appendChild(option)
      })
      document.body.appendChild(brandList)

      // Model datalist - empty initially, will be populated on brand input
      const modelList = document.createElement('datalist')
      modelList.id = `inline-model-list-${it.id}`
      document.body.appendChild(modelList)
    })

    // Setup inline autocomplete listeners
    setupInlineAutocomplete()
  }

  function setupInlineAutocomplete() {
    document.querySelectorAll('[data-field="brand"]').forEach(brandInput => {
      const form = brandInput.closest('.card-edit-form')
      if (!form) return

      const card = form.closest('.card')
      const itemId = card?.dataset.id
      if (!itemId) return

      const modelInput = form.querySelector('[data-field="model"]')

      const updateInlineModelList = () => {
        const selectedBrand = brandInput.value.trim()
        if (!selectedBrand) return

        // Get all models for this brand
        const models = [...new Set(
          items
            .filter(i => i.brand && i.brand.toLowerCase() === selectedBrand.toLowerCase())
            .map(i => i.model)
            .filter(Boolean)
        )].sort()

        // Update model datalist
        const modelList = document.getElementById(`inline-model-list-${itemId}`)
        if (modelList) {
          modelList.innerHTML = ''
          models.forEach(model => {
            const option = document.createElement('option')
            option.value = model
            modelList.appendChild(option)
          })
        }
      }

      brandInput.addEventListener('input', updateInlineModelList)
      brandInput.addEventListener('change', updateInlineModelList)
    })
  }

  form.addEventListener('submit', async e=>{
    e.preventDefault()
    const ratingInput = document.querySelector('input[name="rating"]:checked')
    const data = {
      category: category.value || '',
      name: nameInput.value.trim(),
      brand: brand.value.trim(),
      model: model.value.trim(),
      weight: Number(weight.value) || 0,
      price: price.value ? Number(price.value) : 0,
      year: year.value ? Number(year.value) : null,
      rating: ratingInput ? Number(ratingInput.value) : 0,
      storageId: storageSelect.value || null,
      visibility: getVisibilityValue('gearVisibilityPicker'),
      comment: comment.value.trim() || '',
      image: currentPhotoData || null
    }
    if(!data.name){
      alert('Please provide name.')
      return
    }

    if(!isAuthenticated) {
      alert('Please sign in to add items.')
      return
    }

    let itemId
    if(editingId){
      // Optimistic update: update UI immediately
      const idx = items.findIndex(i=>i.id===editingId)
      const oldItem = idx !== -1 ? {...items[idx]} : null

      if(idx!==-1){
        items[idx] = {...items[idx], ...data}
      }

      itemId = editingId
      editingId = null

      // Update UI immediately
      invalidateStatsCache()
      render()
      modal.classList.add('hidden')
      form.reset()
      currentPhotoData = null
      photoPreview.innerHTML = ''

      // Save to Supabase in background
      SupabaseService.updateGearItem(itemId, data).catch(err => {
        console.error('Error updating item:', err)
        // Rollback on error
        if(oldItem && idx !== -1) {
          items[idx] = oldItem
          invalidateStatsCache()
          render()
        }
        alert('Error updating item: ' + err.message)
      })

      return // Exit early to prevent duplicate render
    } else {
      // Create in Supabase with optimistic UI update
      itemId = uid()
      const newItem = Object.assign({id:itemId, created:Date.now()}, data)

      // Optimistic update: add to UI immediately
      items.unshift(newItem)
      invalidateStatsCache()
      render()

      // Reset form immediately for better UX
      form.reset()
      currentPhotoData = null
      photoPreview.innerHTML = ''

      // Then save to server in background
      SupabaseService.createGearItem(newItem).catch(err => {
        console.error('Error creating item:', err)
        // Rollback on error
        const idx = items.findIndex(i => i.id === itemId)
        if (idx !== -1) {
          items.splice(idx, 1)
          invalidateStatsCache()
          render()
        }
        alert('Error creating item: ' + err.message)
      })

      // Add to selected checklists
      const selectedChecklistIds = Array.from(
        document.querySelectorAll('.add-to-checklist-checkbox:checked')
      ).map(cb => cb.dataset.checklistId)

      if(selectedChecklistIds.length > 0) {
        // Save category collapsed states before re-rendering
        const categoryStates = {}

        // Save category states within checklists
        document.querySelectorAll('.checklist-section').forEach(section => {
          const sectionId = section.dataset.checklistId

          // Save category states within this checklist
          const categoryElements = section.querySelectorAll('.category-section')
          categoryStates[sectionId] = {}
          categoryElements.forEach(catEl => {
            const category = catEl.dataset.category
            const itemsContainer = catEl.querySelector('.category-items')
            if (itemsContainer && category) {
              categoryStates[sectionId][category] = itemsContainer.classList.contains('collapsed')
            }
          })
        })

        selectedChecklistIds.forEach(checklistId => {
          const checklist = checklists.find(cl => cl.id === checklistId)
          if(checklist && canEditResource(checklist)) {
            // Add item if not already in checklist
            if(!checklist.items.find(it => it.itemId === itemId)) {
              checklist.items.push({itemId, checked: false})
            }
          }
        })

        // Update checklists in Supabase if authenticated
        if (SupabaseService.getCurrentUser()) {
          for(const checklistId of selectedChecklistIds) {
            const checklist = checklists.find(cl => cl.id === checklistId)
            if(checklist && canEditResource(checklist)) {
              try {
                await SupabaseService.updateChecklist(checklistId, checklist)
              } catch(err) {
                console.error('Error updating checklist:', err)
              }
            }
          }
        } else {
          // Save to localStorage if not authenticated
          localStorage.setItem('allmygear.checklists', JSON.stringify(checklists))
        }

        // Render and then restore states
        render()
        renderChecklist()

        // Restore category collapsed states after re-rendering (checklist states are now applied during render)
        setTimeout(() => {
          // Restore category states
          Object.keys(categoryStates).forEach(sectionId => {
            const section = document.querySelector(`.checklist-section[data-checklist-id="${sectionId}"]`)
            if (section && categoryStates[sectionId]) {
              Object.keys(categoryStates[sectionId]).forEach(category => {
                const catEl = section.querySelector(`.category-section[data-category="${category}"]`)
                if (catEl) {
                  const itemsContainer = catEl.querySelector('.category-items')
                  const chevron = catEl.querySelector('.cat-chevron')
                  if (itemsContainer && categoryStates[sectionId][category]) {
                    itemsContainer.classList.add('collapsed')
                    if (chevron) {
                      chevron.style.transform = 'rotate(180deg)'
                    }
                  } else if (itemsContainer && !categoryStates[sectionId][category]) {
                    itemsContainer.classList.remove('collapsed')
                    if (chevron) {
                      chevron.style.transform = 'rotate(0deg)'
                    }
                  }
                }
              })
            }
          })
        }, 0)
      } else {
        render()
      }
    }

    // For authenticated users, don't call save() as data is already in Supabase
    // render() is called inside the checklist handling above
    form.reset();
    modal.classList.add('hidden')
    // clear preview
    currentPhotoData = null
    photoPreview.src = ''
    photoPreview.style.display = 'none'
  })

  resetBtn.addEventListener('click', ()=>{ form.reset(); editingId = null })

  // Photo input handling
  const photoInput = document.getElementById('photo')
  const photoPreview = document.getElementById('photoPreview')
  const photoMessage = document.getElementById('photoMessage')
  const modalAddPhotoBtn = document.getElementById('modalAddPhotoBtn')
  const modalRemovePhotoBtn = document.getElementById('modalRemovePhotoBtn')
  const modalPhotoPreviewWrapper = document.getElementById('modalPhotoPreviewWrapper')
  const noPhotoText = modalPhotoPreviewWrapper?.querySelector('.no-photo-text')

  // Add photo button handler
  if (modalAddPhotoBtn && photoInput) {
    modalAddPhotoBtn.addEventListener('click', () => {
      photoInput.click()
    })
  }

  // Remove photo button handler
  if (modalRemovePhotoBtn) {
    modalRemovePhotoBtn.addEventListener('click', () => {
      currentPhotoData = null
      photoPreview.src = ''
      photoPreview.style.display = 'none'
      photoInput.value = ''
      photoMessage.textContent = ''
      modalRemovePhotoBtn.style.display = 'none'
      modalAddPhotoBtn.style.display = ''
      if (noPhotoText) noPhotoText.style.display = ''
    })
  }

  if(photoInput){
    photoInput.addEventListener('change', async ()=>{
      const f = photoInput.files && photoInput.files[0]
      photoMessage.textContent = ''
      photoMessage.className = 'photoMessage'
      if(!f){
        currentPhotoData = null
        photoPreview.src=''
        photoPreview.style.display='none'
        if (modalRemovePhotoBtn) modalRemovePhotoBtn.style.display = 'none'
        if (modalAddPhotoBtn) modalAddPhotoBtn.style.display = ''
        if (noPhotoText) noPhotoText.style.display = ''
        return
      }
      try{
        // If file already small, still convert to dataURL for preview, otherwise process
        if(f.size <= MAX_IMAGE_SIZE){
          const data = await readFileAsDataURL(f)
          currentPhotoData = data
          photoPreview.src = data
          photoPreview.style.display = 'block'
          if (modalRemovePhotoBtn) modalRemovePhotoBtn.style.display = ''
          if (modalAddPhotoBtn) modalAddPhotoBtn.style.display = 'none'
          if (noPhotoText) noPhotoText.style.display = 'none'
          photoMessage.textContent = `File ${Math.round(f.size/1024)} KB — uploaded`;
        } else {
          photoMessage.textContent = `File ${Math.round(f.size/1024)} KB — resizing...`;
          photoMessage.classList.add('warn')
          const data = await processImageFile(f, MAX_IMAGE_SIZE)
          // estimate size from base64 length
          const approxSize = Math.round((data.length - data.indexOf(',') - 1) * 3/4)
          currentPhotoData = data
          photoPreview.src = data
          photoPreview.style.display = 'block'
          if (modalRemovePhotoBtn) modalRemovePhotoBtn.style.display = ''
          if (modalAddPhotoBtn) modalAddPhotoBtn.style.display = 'none'
          if (noPhotoText) noPhotoText.style.display = 'none'
          if(approxSize <= MAX_IMAGE_SIZE){
            photoMessage.textContent = `Image reduced to ≈ ${Math.round(approxSize/1024)} KB`;
            photoMessage.className = 'photoMessage'
          } else {
            photoMessage.textContent = `Failed to reduce to ${Math.round(MAX_IMAGE_SIZE/1024)} KB — result ≈ ${Math.round(approxSize/1024)} KB`;
            photoMessage.classList.add('error')
          }
        }
      }catch(err){
        currentPhotoData = null
        photoPreview.src = ''
        photoPreview.style.display = 'none'
        if (modalRemovePhotoBtn) modalRemovePhotoBtn.style.display = 'none'
        if (modalAddPhotoBtn) modalAddPhotoBtn.style.display = ''
        if (noPhotoText) noPhotoText.style.display = ''
        photoMessage.textContent = 'Error processing image'
        photoMessage.classList.add('error')
        console.error('Photo upload error:', err)
      }
    })
  }

  // helper: read file as dataURL
  function readFileAsDataURL(file){
    return new Promise((resolve,reject)=>{
      const r = new FileReader()
        r.onerror = ()=>reject(new Error('Failed to read file'))
      r.onload = ()=>resolve(r.result)
      r.readAsDataURL(file)
    })
  }

  // processImageFile: resize/compress image using canvas until under maxBytes or minimal quality
  // Convert HEIC/HEIF to JPEG using heic2any library
  async function convertHeicToJpeg(file) {
    if (!window.heic2any) {
      throw new Error('HEIC converter not loaded')
    }

    const blob = await heic2any({
      blob: file,
      toType: 'image/jpeg',
      quality: 0.9
    })

    // heic2any may return array for multi-image HEIC
    const resultBlob = Array.isArray(blob) ? blob[0] : blob

    // Convert blob to File object
    return new File([resultBlob], file.name.replace(/\.heic$/i, '.jpg'), {
      type: 'image/jpeg'
    })
  }

  // Check if file is HEIC format
  function isHeicFile(file) {
    return file.type === 'image/heic' ||
           file.type === 'image/heif' ||
           /\.heic$/i.test(file.name) ||
           /\.heif$/i.test(file.name)
  }

  function processImageFile(file, maxBytes){
    return new Promise(async (resolve, reject) => {
      try {
        // Convert HEIC to JPEG first if needed
        let processFile = file
        if (isHeicFile(file)) {
          try {
            processFile = await convertHeicToJpeg(file)
          } catch (heicErr) {
            console.error('HEIC conversion failed:', heicErr)
            reject(new Error('Failed to convert HEIC image. Please convert to JPEG first.'))
            return
          }
        }

        // Validate file type
        if (!processFile.type.startsWith('image/')) {
          reject(new Error('Invalid file type. Please select an image.'))
          return
        }

        const reader = new FileReader()
        reader.onerror = () => reject(new Error('Failed to read file'))
        reader.onload = () => {
          const img = new Image()
          img.onerror = () => {
            reject(new Error('Failed to load image. The file may be corrupted.'))
          }
          img.onload = () => {
            const MAX_WIDTH = 1024
            const canvas = document.createElement('canvas')
            const ctx = canvas.getContext('2d')
            let width = img.width
            let height = img.height
            // scale down if too wide
            if (width > MAX_WIDTH) {
              height = Math.round(height * (MAX_WIDTH / width))
              width = MAX_WIDTH
            }

            canvas.width = width
            canvas.height = height
            ctx.drawImage(img, 0, 0, width, height)

            let quality = 0.9
            const minQuality = 0.4

            function attempt() {
              try {
                const dataURL = canvas.toDataURL('image/jpeg', quality)
                const size = Math.round((dataURL.length - dataURL.indexOf(',') - 1) * 3 / 4)
                if (size <= maxBytes || quality <= minQuality) {
                  resolve(dataURL)
                } else {
                  quality = Math.max(minQuality, quality - 0.15)
                  // if reached minQuality and still too large, shrink dimensions and retry
                  if (quality === minQuality && size > maxBytes) {
                    // shrink canvas by 80% and retry
                    width = Math.round(width * 0.8)
                    height = Math.round(height * 0.8)
                    canvas.width = width
                    canvas.height = height
                    ctx.drawImage(img, 0, 0, width, height)
                  }
                  // Use requestAnimationFrame for non-blocking processing
                  requestAnimationFrame(attempt)
                }
              } catch (e) {
                reject(e)
              }
            }

            attempt()
          }
          img.src = reader.result
        }
        reader.readAsDataURL(processFile)
      } catch (err) {
        reject(err)
      }
    })
  }

  // Handle card expansion on click
  cardsEl.addEventListener('click', e => {
    // Ignore clicks on buttons, inputs, and other interactive elements
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) {
      return
    }

    const card = e.target.closest('.card')
    if (!card) return

    // Don't expand if card is being edited
    if (card.classList.contains('expanded') && card.querySelector('.card-edit-form:not(.hidden)')) {
      return
    }

    // Toggle expansion with animation
    if (card.classList.contains('expanded')) {
      // Collapsing - add collapsing class and wait for animation
      card.classList.add('collapsing')

      setTimeout(() => {
        card.classList.remove('expanded', 'collapsing')
      }, 400) // Match animation duration
    } else {
      // Expanding - just add expanded class
      card.classList.add('expanded')
    }
  })

  // delegate card buttons
  cardsEl.addEventListener('click', e=>{
    const btn = e.target.closest('button')
    if(!btn) return
    const id = btn.dataset.id
    const action = btn.dataset.action
    if(action==='toggle-category-group'){
      const catSection = e.target.closest('.category-section')
      if(catSection){
        const itemsContainer = catSection.querySelector('.category-items')
        const chevron = catSection.querySelector('.cat-chevron')
        const isCollapsing = !itemsContainer.classList.contains('collapsed')

        itemsContainer.classList.toggle('collapsed')

        // Автоматически сворачиваем все расширенные карточки в этой категории при сворачивании категории
        if(isCollapsing) {
          const expandedCards = itemsContainer.querySelectorAll('.card.expanded')
          expandedCards.forEach(card => {
            card.classList.remove('expanded')
          })
        }

        if(itemsContainer.classList.contains('collapsed')){
          chevron.style.transform = 'rotate(180deg)'
        } else {
          chevron.style.transform = 'rotate(0deg)'
        }
      }
    } else if(action==='edit'){
      const card = e.target.closest('.card')
      if(!card) return
      const item = items.find(i => i.id === id)
      if (item && !canEditResource(item)) {
        alertOwnerOnly('gear items')
        return
      }
      const editForm = card.querySelector('.card-edit-form')
      if(editForm){
        editForm.classList.remove('hidden')
        card.classList.add('expanded')
        card.classList.add('editing')
        const picker = editForm.querySelector('.inline-visibility-picker')
        if (picker && visibilityUI) {
          visibilityUI.renderVisibilityPicker(picker, {
            value: item?.visibility || 'public',
            entitlements: visibilityEntitlements,
            grants: item?.grants || []
          })
        }
      }
    }
  })

  // Handle photo change in inline edit form
  cardsEl.addEventListener('change', async e=>{
    if(e.target.matches('[data-field="photo"]')){
      const input = e.target
      const id = input.dataset.id
      const item = items.find(i => i.id === id)
      if (item && !canEditResource(item)) {
        input.value = ''
        alertOwnerOnly('gear items')
        return
      }
      const card = input.closest('.card')
      const message = card.querySelector(`.edit-photo-message[data-id="${id}"], .photo-message[data-id="${id}"]`)
      const f = input.files && input.files[0]

      if(message) {
        message.textContent = ''
        message.className = 'edit-photo-message photo-message'
      }

      if(!f){
        input.dataset.photoData = ''
        input.dataset.photoChanged = 'true'
        return
      }

      try{
        if(f.size <= MAX_IMAGE_SIZE){
          const data = await readFileAsDataURL(f)
          input.dataset.photoData = data
          input.dataset.photoChanged = 'true'

          // Update item immediately
          const itemIdx = items.findIndex(i => i.id === id)
          if(itemIdx !== -1){
            items[itemIdx].image = data
            render() // Re-render to update thumbnail immediately

            // Save to Supabase in background
            SupabaseService.updateGearItem(id, { image: data }).catch(err => {
              console.error('Error updating item with photo:', err)
            })
          }

          if(message) {
            message.textContent = `File ${Math.round(f.size/1024)} KB — uploaded`
            message.style.color = '#6b7a67'
          }
        } else {
          if(message) {
            message.textContent = `File ${Math.round(f.size/1024)} KB — resizing...`
            message.style.color = '#fbbf24'
          }
          const data = await processImageFile(f, MAX_IMAGE_SIZE)
          const approxSize = Math.round((data.length - data.indexOf(',') - 1) * 3/4)
          input.dataset.photoData = data
          input.dataset.photoChanged = 'true'

          // Update item immediately
          const itemIdx = items.findIndex(i => i.id === id)
          if(itemIdx !== -1){
            items[itemIdx].image = data
            render() // Re-render to update thumbnail immediately

            // Save to Supabase in background
            SupabaseService.updateGearItem(id, { image: data }).catch(err => {
              console.error('Error updating item with photo:', err)
            })
          }

          if(approxSize <= MAX_IMAGE_SIZE){
            if(message) {
              message.textContent = `Image reduced to ≈ ${Math.round(approxSize/1024)} KB`
              message.style.color = '#6b7a67'
            }
          } else {
            if(message) {
              message.textContent = `Failed to reduce to ${Math.round(MAX_IMAGE_SIZE/1024)} KB — result ≈ ${Math.round(approxSize/1024)} KB`
              message.style.color = '#fb7185'
            }
          }
        }
      } catch(err){
        input.dataset.photoData = ''
        console.error('Photo processing error:', err)
        if(message) {
          message.textContent = err.message || 'Failed to process image'
          message.style.color = '#fb7185'
        }
      }
    }
  })

  // Handle inline card edit save and cancel
  cardsEl.addEventListener('click', async e=>{
    // Handle photo action buttons
    // Handle photo overlay buttons
    if(e.target.closest('.photo-overlay-btn')){
      e.stopPropagation()
      const btn = e.target.closest('.photo-overlay-btn')
      const action = btn.dataset.action
      const id = btn.dataset.id
      const item = items.find(i => i.id === id)
      if (item && !canEditResource(item)) {
        alertOwnerOnly('gear items')
        return
      }
      const fileInput = document.querySelector(`.photo-file-input[data-id="${id}"]`)

      if(action === 'add-photo' || action === 'replace-photo'){
        fileInput.click()
      } else if(action === 'remove-photo'){
        // Remove photo
        const itemIdx = items.findIndex(i => i.id === id)
        if(itemIdx !== -1){
          items[itemIdx].image = null
          render() // Re-render immediately

          // Save to Supabase in background
          SupabaseService.updateGearItem(id, { image: null }).catch(err => {
            console.error('Error removing photo:', err)
          })
        }
      }
      return
    }

    if(e.target.closest('.photo-action-btn')){
      e.stopPropagation()
      const btn = e.target.closest('.photo-action-btn')
      const id = btn.dataset.id
      const item = items.find(i => i.id === id)
      if (item && !canEditResource(item)) {
        alertOwnerOnly('gear items')
        return
      }
      const fileInput = document.querySelector(`.photo-file-input[data-id="${id}"]`)

      if(btn.classList.contains('add-photo') || btn.classList.contains('replace-photo')){
        fileInput.click()
      } else if(btn.classList.contains('remove-photo')){
        // Remove photo
        const itemIdx = items.findIndex(i => i.id === id)
        if(itemIdx !== -1){
          items[itemIdx].image = null
          render() // Re-render immediately

          // Save to Supabase in background
          SupabaseService.updateGearItem(id, { image: null }).catch(err => {
            console.error('Error removing photo:', err)
          })
        }
      }
      return
    }

    if(e.target.closest('.save-edit')){
      const btn = e.target.closest('.save-edit')
      const id = btn.dataset.id
      const item = items.find(i => i.id === id)
      if (item && !canEditResource(item)) {
        alertOwnerOnly('gear items')
        return
      }
      const card = btn.closest('.card')
      const form = card.querySelector('.card-edit-form')

      const name = form.querySelector('[data-field="name"]').value.trim()
      if(!name){
        alert('Name is required')
        return
      }

      const itemIdx = items.findIndex(i=>i.id===id)
      if(itemIdx !== -1){
        const oldCategory = items[itemIdx].category
        const newCategory = form.querySelector('[data-field="category"]').value || ''

        items[itemIdx].category = newCategory
        items[itemIdx].name = name
        items[itemIdx].brand = form.querySelector('[data-field="brand"]').value.trim()
        items[itemIdx].model = form.querySelector('[data-field="model"]').value.trim()
        items[itemIdx].weight = Number(form.querySelector('[data-field="weight"]').value) || 0
        items[itemIdx].price = form.querySelector('[data-field="price"]').value ? Number(form.querySelector('[data-field="price"]').value) : 0
        items[itemIdx].year = form.querySelector('[data-field="year"]').value ? Number(form.querySelector('[data-field="year"]').value) : null

        // Handle storageId update
        const storageIdField = form.querySelector('[data-field="storageId"]')
        items[itemIdx].storageId = storageIdField && storageIdField.value ? storageIdField.value : null

        // Handle comment update
        const commentField = form.querySelector('[data-field="comment"]')
        items[itemIdx].comment = commentField ? commentField.value.trim() : ''

        const visibilityPicker = form.querySelector('.inline-visibility-picker')
        if (visibilityPicker && visibilityUI) {
          items[itemIdx].visibility = visibilityUI.getSelectedVisibility(visibilityPicker)
        }

        // Handle rating update
        const ratingInput = card.querySelector(`input[name="rating-${id}"]:checked`)
        items[itemIdx].rating = ratingInput ? Number(ratingInput.value) : 0

        // Handle photo update
        const photoInput = form.querySelector('[data-field="photo"]')
        if(photoInput && photoInput.dataset.photoChanged === 'true'){
          // Photo was changed (either new photo or cleared)
          items[itemIdx].image = photoInput.dataset.photoData || null
        }
        // If photoChanged flag is not set, preserve existing image

        // Save to Supabase for authenticated users (in background)
        if(isAuthenticated) {
          const itemData = {...items[itemIdx]}
          SupabaseService.updateGearItem(id, itemData).catch(err => {
            console.error('Error updating item:', err)
            alert('Error updating item: ' + err.message)
          })
        }
      }

      // If category changed, do full re-render to move card to new category
      const it = items.find(i=>i.id===id)
      if(it && it.category !== card.closest('.category-section')?.dataset.category){
        render()
        return
      }
      // Update card display without re-rendering everything
      if(it){
        card.querySelector('.weight-badge').textContent = formatWeight(it.weight)
        card.querySelector('.price-badge').textContent = it.price ? formatPrice(it.price) : '-'
        card.querySelector('h3').textContent = it.name
        const attrs = card.querySelectorAll('.attrs span')
        if(attrs[0]) attrs[0].textContent = it.brand || '-'
        if(attrs[1]) attrs[1].textContent = it.model || '-'

        // Update or add year badge in price section
        const priceSection = card.querySelector('.card-price-section')
        const existingYearBadge = priceSection.querySelector('.year-badge')
        if(it.year){
          if(existingYearBadge){
            existingYearBadge.textContent = it.year
          } else {
            const yearBadge = document.createElement('span')
            yearBadge.className = 'year-badge'
            yearBadge.textContent = it.year
            priceSection.insertBefore(yearBadge, priceSection.firstChild)
          }
        } else if(existingYearBadge){
          existingYearBadge.remove()
        }

        // Update or add thumbnail
        const existingThumb = card.querySelector('.thumb')
        if(it.image){
          if(existingThumb){
            existingThumb.src = it.image
          } else {
            const img = document.createElement('img')
            img.className = 'thumb'
            img.src = it.image
            img.alt = it.name
            card.insertBefore(img, card.firstChild)
          }
        } else if(existingThumb){
          existingThumb.remove()
        }
      }
      // Close the edit form
      form.classList.add('hidden')
      card.classList.remove('expanded')
      card.classList.remove('editing')

      // Re-render to update the card display with new rating
      render()
    } else if(e.target.closest('.cancel-edit')){
      const card = e.target.closest('.card')
      const form = card.querySelector('.card-edit-form')

      // Reset photo change flag
      const photoInput = form.querySelector('[data-field="photo"]')
      if(photoInput) {
        delete photoInput.dataset.photoChanged
        delete photoInput.dataset.photoData
      }

      form.classList.add('hidden')
      card.classList.remove('expanded')
      card.classList.remove('editing')
    } else if(e.target.closest('.delete-edit')){
      const btn = e.target.closest('.delete-edit')
      const id = btn.dataset.id
      const item = items.find(i => i.id === id)
      if (item && !canEditResource(item)) {
        alertOwnerOnly('gear items')
        return
      }

      if (!SupabaseService.getCurrentUser()) {
        alert('Please sign in to delete items')
        return
      }

      showConfirm('Delete item?', 'This action cannot be undone.', async ()=>{
        // Optimistic delete: remove from UI immediately
        const deletedItem = items.find(i=>i.id===id)
        items = items.filter(i=>i.id!==id)
        invalidateStatsCache()
        render()

        // Delete from Supabase in background
        SupabaseService.deleteGearItem(id).catch(err => {
          console.error('Error deleting item:', err)
          // Rollback on error
          if(deletedItem) {
            items.push(deletedItem)
            invalidateStatsCache()
            render()
          }
          alert('Error deleting item: ' + err.message)
        })
      })
    }
  })

  // Debounced search is now handled in the toolbar inside render()
  // Old search listener removed since search input is now dynamically created
  filterCategory.addEventListener('change', render)

  // Category sort handler via select dropdown
  cardsEl.addEventListener('change', async (e) => {
    if (e.target.classList.contains('category-sort-select')) {
      const category = e.target.dataset.category
      const sortOption = e.target.value
      const categorySection = e.target.closest('.category-section')
      const itemsContainer = categorySection.querySelector('.category-items')
      const cards = Array.from(itemsContainer.querySelectorAll('.card'))

      // Save sort mode for this category
      categorySortMode[category] = sortOption

      // Save category order to Supabase
      if (SupabaseService.getCurrentUser()) {
        SupabaseService.saveCategoryOrder(categoryOrder, categorySortMode).catch(err => {
          console.error('Error saving category order:', err)
        })
      }

      // Update button
      const wrapper = categorySection.querySelector('.category-sort-wrapper')
      const orderBtn = wrapper.querySelector('.category-sort-order-btn')
      const typeBtn = wrapper.querySelector('.category-sort-type-btn')
      const sortLabels = {
        name: 'Name',
        weight: 'Weight',
        price: 'Price',
        year: 'Year',
        rating: 'Rating'
      }
      if (typeBtn) {
        const label = typeBtn.querySelector('.sort-label')
        if (label) label.textContent = sortLabels[sortOption]
      }

      // Hide/show order button based on mode
      if (orderBtn) {
        orderBtn.classList.remove('hidden')
      }

      // Sort cards
      const currentOrder = orderBtn ? (orderBtn.dataset.order || 'asc') : 'asc'
      cards.sort((a, b) => {
        const itemA = items.find(it => it.id === a.dataset.id)
        const itemB = items.find(it => it.id === b.dataset.id)

        let result = 0
        switch(sortOption) {
          case 'weight':
            result = (Number(itemA.weight) || 0) - (Number(itemB.weight) || 0)
            break
          case 'price':
            result = (Number(itemA.price) || 0) - (Number(itemB.price) || 0)
            break
          case 'year':
            result = (Number(itemA.year) || 0) - (Number(itemB.year) || 0)
            break
          case 'rating':
            result = (Number(itemA.rating) || 0) - (Number(itemB.rating) || 0)
            break
          case 'name':
          default:
            result = itemA.name.localeCompare(itemB.name)
        }

        return currentOrder === 'asc' ? result : -result
      })

      // Update items array order to match sorted cards
      const sortedIds = cards.map(card => card.dataset.id)
      const categoryItems = items.filter(it => it.category === category)
      const otherItems = items.filter(it => it.category !== category)

      // Reorder category items based on sorted cards
      categoryItems.sort((a, b) => {
        return sortedIds.indexOf(a.id) - sortedIds.indexOf(b.id)
      })

      // Rebuild items array with new order
      items = [...otherItems, ...categoryItems]

      // Save to Supabase
      if (SupabaseService.getCurrentUser()) {
        await SupabaseService.saveItems(items)
      }

      // Re-append in sorted order
      cards.forEach(card => itemsContainer.appendChild(card))

      // Don't call render() - just update DOM directly to avoid re-sorting
      // render()

      // Remove focus from select to hide dropdown
      e.target.blur()
    }
  })

  // Sort order button click toggles asc/desc
  cardsEl.addEventListener('click', (e) => {
    const orderBtn = e.target.closest('.category-sort-order-btn')
    if (orderBtn) {
      e.stopPropagation()
      e.preventDefault()

      const categorySection = orderBtn.closest('.category-section')
      const category = categorySection.dataset.category
      const currentMode = categorySortMode[category] || 'name'

      // Always allow toggle

      // Toggle order
      const currentOrder = orderBtn.dataset.order || 'asc'
      const newOrder = currentOrder === 'asc' ? 'desc' : 'asc'
      orderBtn.dataset.order = newOrder

      // Toggle icons
      const iconAsc = orderBtn.querySelector('.icon-asc')
      const iconDesc = orderBtn.querySelector('.icon-desc')
      if (iconAsc && iconDesc) {
        if (newOrder === 'asc') {
          iconAsc.style.display = 'block'
          iconDesc.style.display = 'none'
        } else {
          iconAsc.style.display = 'none'
          iconDesc.style.display = 'block'
        }
      }

      // Re-sort with new order
      const catSection = orderBtn.closest('.category-section')
      const itemsContainer = catSection.querySelector('.category-items')
      const cards = Array.from(itemsContainer.querySelectorAll('.card'))
      const select = catSection.querySelector('.category-sort-select')
      const sortOption = select.value

      cards.sort((a, b) => {
        const itemA = items.find(it => it.id === a.dataset.id)
        const itemB = items.find(it => it.id === b.dataset.id)

        let result = 0
        switch(sortOption) {
          case 'weight':
            result = (Number(itemA.weight) || 0) - (Number(itemB.weight) || 0)
            break
          case 'price':
            result = (Number(itemA.price) || 0) - (Number(itemB.price) || 0)
            break
          case 'year':
            result = (Number(itemA.year) || 0) - (Number(itemB.year) || 0)
            break
          case 'rating':
            result = (Number(itemA.rating) || 0) - (Number(itemB.rating) || 0)
            break
          case 'name':
          default:
            result = itemA.name.localeCompare(itemB.name)
        }

        return newOrder === 'asc' ? result : -result
      })

      // Update items array order to match sorted cards
      const sortedIds = cards.map(card => card.dataset.id)
      const categoryItems = items.filter(it => it.category === category)
      const otherItems = items.filter(it => it.category !== category)

      // Reorder category items based on sorted cards
      categoryItems.sort((a, b) => {
        return sortedIds.indexOf(a.id) - sortedIds.indexOf(b.id)
      })

      // Rebuild items array with new order
      items = [...otherItems, ...categoryItems]

      cards.forEach(card => itemsContainer.appendChild(card))
      return
    }

    // Sort type button click opens dropdown
    const typeBtn = e.target.closest('.category-sort-type-btn')
    if (typeBtn) {
      e.stopPropagation()
      e.preventDefault()

      const wrapper = typeBtn.closest('.category-sort-wrapper')
      const select = wrapper.querySelector('.category-sort-select')
      if (select) {
        select.focus()
        select.click()
      }
    }
  })

  // Handle inline storage creation in edit form
  cardsEl.addEventListener('click', async (e) => {
    const createBtn = e.target.closest('.create-storage-inline')
    if (createBtn) {
      e.stopPropagation()
      const itemId = createBtn.dataset.itemId
      const form = document.querySelector(`.storage-inline-form-edit[data-item-id="${itemId}"]`)
      if (form) {
        form.style.display = 'block'
        const input = form.querySelector('.new-storage-name-edit')
        if (input) input.focus()
      }
    }

    const cancelStorageBtn = e.target.closest('.cancel-storage-inline-edit')
    if (cancelStorageBtn) {
      e.stopPropagation()
      const itemId = cancelStorageBtn.dataset.itemId
      const form = document.querySelector(`.storage-inline-form-edit[data-item-id="${itemId}"]`)
      if (form) {
        form.style.display = 'none'
        const input = form.querySelector('.new-storage-name-edit')
        if (input) input.value = ''
      }
    }

    const saveStorageBtn = e.target.closest('.save-storage-inline-edit')
    if (saveStorageBtn) {
      e.stopPropagation()
      const itemId = saveStorageBtn.dataset.itemId
      const form = document.querySelector(`.storage-inline-form-edit[data-item-id="${itemId}"]`)
      const input = form?.querySelector('.new-storage-name-edit')
      const storageName = input?.value.trim()

      if (!storageName) return

      try {
        saveStorageBtn.disabled = true
        saveStorageBtn.textContent = 'Saving...'

        const newStorage = await SupabaseService.createStorage(storageName)
        storages.push(newStorage)

        // Update the select in this edit form
        const card = document.querySelector(`[data-id="${itemId}"]`)
        const storageSelect = card?.querySelector('.edit-field[data-field="storageId"]')
        if (storageSelect) {
          const option = document.createElement('option')
          option.value = newStorage.id
          option.textContent = newStorage.name
          option.selected = true
          storageSelect.appendChild(option)
        }

        form.style.display = 'none'
        input.value = ''
        saveStorageBtn.disabled = false
        saveStorageBtn.textContent = 'Save'
      } catch (err) {
        console.error('Error creating storage:', err)
        alert('Failed to create storage: ' + err.message)
        saveStorageBtn.disabled = false
        saveStorageBtn.textContent = 'Save'
      }
    }
  })

  // Handle inline checklist creation in edit form
  cardsEl.addEventListener('click', async (e) => {
    const createBtn = e.target.closest('.create-checklist-inline-edit')
    if (createBtn) {
      e.stopPropagation()
      const itemId = createBtn.dataset.itemId
      const form = document.querySelector(`.checklist-inline-form-edit[data-item-id="${itemId}"]`)
      if (form) {
        form.style.display = 'block'
        const input = form.querySelector('.new-checklist-name-edit')
        if (input) input.focus()
      }
    }

    const cancelChecklistBtn = e.target.closest('.cancel-checklist-inline-edit')
    if (cancelChecklistBtn) {
      e.stopPropagation()
      const itemId = cancelChecklistBtn.dataset.itemId
      const form = document.querySelector(`.checklist-inline-form-edit[data-item-id="${itemId}"]`)
      if (form) {
        form.style.display = 'none'
        const input = form.querySelector('.new-checklist-name-edit')
        if (input) input.value = ''
      }
    }

    const saveChecklistBtn = e.target.closest('.save-checklist-inline-edit')
    if (saveChecklistBtn) {
      e.stopPropagation()
      const itemId = saveChecklistBtn.dataset.itemId
      const form = document.querySelector(`.checklist-inline-form-edit[data-item-id="${itemId}"]`)
      const input = form?.querySelector('.new-checklist-name-edit')
      const checklistName = input?.value.trim()

      if (!checklistName) return

      try {
        saveChecklistBtn.disabled = true
        saveChecklistBtn.textContent = 'Saving...'

        const newChecklist = {
          id: uid(),
          name: checklistName,
          tags: [],
          startDate: null,
          endDate: null,
          items: [{itemId, checked: false}],
          created: Date.now()
        }

        if (SupabaseService.getCurrentUser()) {
          const savedChecklist = await SupabaseService.createChecklist(newChecklist)
          checklists.push(savedChecklist)
        } else {
          checklists.push(newChecklist)
          localStorage.setItem('allmygear.checklists', JSON.stringify(checklists))
        }

        // Update the checklist checkboxes in this edit form
        const card = document.querySelector(`[data-id="${itemId}"]`)
        const container = card?.querySelector('.edit-checklists-container')
        if (container) {
          const label = document.createElement('label')
          label.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;'
          label.innerHTML = `
            <input type="checkbox" class="edit-checklist-checkbox" data-checklist-id="${newChecklist.id}" data-item-id="${itemId}" checked style="cursor:pointer;width:18px;height:18px;">
            <span style="font-size:13px;">${escapeHtml(checklistName)}</span>
          `
          container.appendChild(label)
        }

        form.style.display = 'none'
        input.value = ''
        saveChecklistBtn.disabled = false
        saveChecklistBtn.textContent = 'Save'

        renderChecklist()
      } catch (err) {
        console.error('Error creating checklist:', err)
        alert('Failed to create checklist: ' + err.message)
        saveChecklistBtn.disabled = false
        saveChecklistBtn.textContent = 'Save'
      }
    }
  })

  // Handle checklist checkbox changes in edit form
  cardsEl.addEventListener('change', async (e) => {
    const checkbox = e.target.closest('.edit-checklist-checkbox')
    if (checkbox) {
      const checklistId = checkbox.dataset.checklistId
      const itemId = checkbox.dataset.itemId
      const checklist = checklists.find(cl => cl.id === checklistId)

      if (!checklist) return

      if (checkbox.checked) {
        // Add to checklist
        if (!checklist.items.find(i => i.itemId === itemId)) {
          checklist.items.push({itemId, checked: false})
        }
      } else {
        // Remove from checklist
        checklist.items = checklist.items.filter(i => i.itemId !== itemId)
      }

      // Save changes
      if (SupabaseService.getCurrentUser()) {
        try {
          await SupabaseService.updateChecklist(checklistId, checklist)
        } catch (err) {
          console.error('Error updating checklist:', err)
        }
      } else {
        localStorage.setItem('allmygear.checklists', JSON.stringify(checklists))
      }

      renderChecklist()
    }
  })

  // Remove old drag and drop handlers - items ordering within categories removed
  // Simplified handlers for compatibility
  function createDropIndicator() { return null }
  function handleCardDragStart(e){}
  function handleCardDragOver(e){}
  function handleCardDrop(e){}
  function handleCardDragEnd(e){}
  function handleCategoryDragOver(e){}
  function handleCategoryDrop(e){}

  // Autocomplete functionality
  function setupAutocomplete() {
    const brandInput = document.getElementById('brand')
    const modelInput = document.getElementById('model')

    if (!brandInput || !modelInput) return

    // Remove existing datalists if any
    document.querySelectorAll('#brand-list, #model-list').forEach(el => el.remove())

    // Create brand datalist
    const brandList = document.createElement('datalist')
    brandList.id = 'brand-list'
    outdoorBrands.forEach(brand => {
      const option = document.createElement('option')
      option.value = brand
      brandList.appendChild(option)
    })
    document.body.appendChild(brandList)
    brandInput.setAttribute('list', 'brand-list')

    // Create model datalist dynamically based on brand
    const updateModelList = () => {
      const selectedBrand = brandInput.value.trim()
      if (!selectedBrand) return

      // Get all models for this brand from existing items
      const models = [...new Set(
        items
          .filter(i => i.brand && i.brand.toLowerCase() === selectedBrand.toLowerCase())
          .map(i => i.model)
          .filter(Boolean)
      )].sort()

      // Remove old model list
      const oldModelList = document.getElementById('model-list')
      if (oldModelList) oldModelList.remove()

      // Create new model list
      if (models.length > 0) {
        const modelList = document.createElement('datalist')
        modelList.id = 'model-list'
        models.forEach(model => {
          const option = document.createElement('option')
          option.value = model
          modelList.appendChild(option)
        })
        document.body.appendChild(modelList)
        modelInput.setAttribute('list', 'model-list')
      } else {
        modelInput.removeAttribute('list')
      }
    }

    brandInput.addEventListener('input', updateModelList)
    brandInput.addEventListener('change', updateModelList)
  }

  // Confirm dialog
  const confirmModal = document.getElementById('confirmModal')
  const confirmTitle = document.getElementById('confirmTitle')
  const confirmMessage = document.getElementById('confirmMessage')
  const confirmOk = document.getElementById('confirmOk')
  const confirmCancel = document.getElementById('confirmCancel')
  let confirmCallback = null

  function showCustomAlert(message, title = 'Attention'){
    const alertModal = document.createElement('div')
    alertModal.className = 'modal'
    alertModal.innerHTML = `
      <div class="modal-content alert-modal-content" style="max-width:380px;">
        <div class="modal-header">
          <div class="modal-title-section">
            <img src="img/AMG_icon_white.svg" alt="AllMyGear" style="height:100%;max-height:62px;margin-right:12px;">
            <h2>${escapeHtml(title)}</h2>
          </div>
          <button class="modal-close-btn alert-close" aria-label="Close">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div class="modal-body" style="text-align:center;padding:24px;">
          <div class="alert-icon">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="var(--brand-orange)">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
            </svg>
          </div>
          <p style="margin:16px 0 24px;font-size:15px;color:var(--card-text);line-height:1.5;">${escapeHtml(message)}</p>
          <button class="btn-primary alert-ok" style="width:100%;">OK</button>
        </div>
      </div>
    `
    document.body.appendChild(alertModal)
    setTimeout(() => alertModal.classList.remove('hidden'), 10)

    const okBtn = alertModal.querySelector('.alert-ok')
    const closeBtn = alertModal.querySelector('.alert-close')
    const closeAlert = () => {
      alertModal.classList.add('hidden')
      setTimeout(() => alertModal.remove(), 200)
    }

    okBtn.addEventListener('click', closeAlert)
    closeBtn.addEventListener('click', closeAlert)
    alertModal.addEventListener('click', e => {
      if(e.target === alertModal) closeAlert()
    })
  }

  function showConfirm(title, message, callback, okButtonText = 'Delete', isDanger = true){
    confirmTitle.textContent = title
    confirmMessage.textContent = message
    confirmOk.textContent = okButtonText

    // Toggle danger class based on action type
    if(isDanger){
      confirmOk.classList.add('danger')
      confirmOk.classList.remove('primary')
    } else {
      confirmOk.classList.remove('danger')
      confirmOk.classList.add('primary')
    }

    confirmCallback = callback
    confirmModal.classList.remove('hidden')
  }

  confirmOk.addEventListener('click', ()=>{
    confirmModal.classList.add('hidden')
    if(confirmCallback) confirmCallback()
    confirmCallback = null
  })

  confirmCancel.addEventListener('click', ()=>{
    confirmModal.classList.add('hidden')
    confirmCallback = null
  })

  confirmModal.addEventListener('click', e=>{
    if(e.target === confirmModal){
      confirmModal.classList.add('hidden')
      confirmCallback = null
    }
  })

  // Modal handlers
  addBtn.addEventListener('click', ()=>{
    editingId = null
    modalTitle.textContent = 'Add gear'
    modal.classList.remove('hidden')
    // Clear rating selection
    document.querySelectorAll('input[name="rating"]').forEach(r => r.checked = false)

    // Hide remove photo button when creating new item
    if (modalRemovePhotoBtn) modalRemovePhotoBtn.style.display = 'none'
    if (modalAddPhotoBtn) modalAddPhotoBtn.style.display = ''

    updateCategorySelect()
    populateStorageDropdown()
    renderVisibilityPicker('gearVisibilityPicker', { visibility: 'public' })
    setupAutocomplete()
    renderAddToChecklistsSection()
  })

  // Manage storages modal handlers
  const manageStoragesModal = document.getElementById('manageStoragesModal')
  const closeManageStoragesModalBtn = document.getElementById('closeManageStoragesModal')

  if (closeManageStoragesModalBtn) {
    closeManageStoragesModalBtn.addEventListener('click', () => {
      manageStoragesModal.classList.add('hidden')
    })
  }

  if (manageStoragesModal) {
    manageStoragesModal.addEventListener('click', e => {
      if (e.target === manageStoragesModal) {
        manageStoragesModal.classList.add('hidden')
      }
    })

    // Handle edit and delete clicks
    manageStoragesModal.addEventListener('click', e => {
      const editBtn = e.target.closest('.edit-storage')
      if (editBtn) {
        const storageId = editBtn.dataset.id
        editStorage(storageId)
        return
      }

      const deleteBtn = e.target.closest('.delete-storage')
      if (deleteBtn) {
        const storageId = deleteBtn.dataset.id
        deleteStorage(storageId)
        return
      }
    })
  }

  // Add storage in manage modal
  const addStorageInManageBtn = document.getElementById('addStorageInManage')
  const newStorageNameInManage = document.getElementById('newStorageNameInManage')
  const newStorageAddressInManage = document.getElementById('newStorageAddressInManage')
  const newStorageDescriptionInManage = document.getElementById('newStorageDescriptionInManage')
  const newStorageRatingInManage = document.getElementById('newStorageRatingInManage')

  if (addStorageInManageBtn && newStorageNameInManage) {
    addStorageInManageBtn.addEventListener('click', async () => {
      const storageName = newStorageNameInManage.value.trim()
      if (!storageName) {
        alert('Please enter a storage name')
        return
      }

      try {
        addStorageInManageBtn.disabled = true
        addStorageInManageBtn.textContent = 'Creating...'

        const newStorage = await SupabaseService.createStorage({
          name: storageName,
          address: newStorageAddressInManage?.value.trim() || '',
          description: newStorageDescriptionInManage?.value.trim() || '',
          rating: newStorageRatingInManage?.value ? Number(newStorageRatingInManage.value) : 0,
          visibility: 'public'
        })
        storages.push(newStorage)

        // Refresh storage list
        openManageStoragesModal()
        populateStorageDropdown()

        // Clear input
        newStorageNameInManage.value = ''
        if (newStorageAddressInManage) newStorageAddressInManage.value = ''
        if (newStorageDescriptionInManage) newStorageDescriptionInManage.value = ''
        setStorageRatingValue(newStorageRatingInManage, 0)

        addStorageInManageBtn.disabled = false
        addStorageInManageBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;margin-right:6px;">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          Add
        `
      } catch (err) {
        console.error('Error creating storage:', err)
        alert('Failed to create storage: ' + err.message)
        addStorageInManageBtn.disabled = false
        addStorageInManageBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;margin-right:6px;">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          Add
        `
      }
    })

    // Handle Enter key
    newStorageNameInManage.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        addStorageInManageBtn.click()
      }
    })
  }

  // Create Storage Modal handlers
  const createStorageModal = document.getElementById('createStorageModal')
  const closeCreateStorageModalBtn = document.getElementById('closeCreateStorageModal')
  const createStorageForm = document.getElementById('createStorageForm')
  const cancelCreateStorageBtn = document.getElementById('cancelCreateStorage')

  if (closeCreateStorageModalBtn) {
    closeCreateStorageModalBtn.addEventListener('click', () => {
      createStorageModal.classList.add('hidden')
    })
  }

  if (cancelCreateStorageBtn) {
    cancelCreateStorageBtn.addEventListener('click', () => {
      createStorageModal.classList.add('hidden')
    })
  }

  if (createStorageModal) {
    createStorageModal.addEventListener('click', e => {
      if (e.target === createStorageModal) {
        createStorageModal.classList.add('hidden')
      }
    })
  }

  if (createStorageForm) {
    createStorageForm.addEventListener('submit', async (e) => {
      e.preventDefault()
      await createNewStorage()
    })
  }

  // Create storage from gear modal
  const createStorageInModalBtn = document.getElementById('createStorageInModal')
  const storageInlineForm = document.getElementById('storageInlineForm')
  const newStorageNameInput = document.getElementById('newStorageName')
  const saveStorageInlineBtn = document.getElementById('saveStorageInline')
  const cancelStorageInlineBtn = document.getElementById('cancelStorageInline')

  if (createStorageInModalBtn) {
    createStorageInModalBtn.addEventListener('click', () => {
      storageInlineForm.style.display = 'block'
      newStorageNameInput.focus()
    })
  }

  if (cancelStorageInlineBtn) {
    cancelStorageInlineBtn.addEventListener('click', () => {
      storageInlineForm.style.display = 'none'
      newStorageNameInput.value = ''
    })
  }

  if (saveStorageInlineBtn) {
    saveStorageInlineBtn.addEventListener('click', async () => {
      const storageName = newStorageNameInput.value.trim()
      if (!storageName) return

      try {
        saveStorageInlineBtn.disabled = true
        saveStorageInlineBtn.textContent = 'Saving...'

        const newStorage = await SupabaseService.createStorage(storageName)
        storages.push(newStorage)
        populateStorageDropdown()

        // Select the newly created storage
        const storageSelect = document.getElementById('storage')
        if (storageSelect) {
          storageSelect.value = newStorage.id
        }

        // Hide form and reset
        storageInlineForm.style.display = 'none'
        newStorageNameInput.value = ''
        saveStorageInlineBtn.disabled = false
        saveStorageInlineBtn.textContent = 'Save'
      } catch (err) {
        console.error('Error creating storage:', err)
        alert('Failed to create storage: ' + err.message)
        saveStorageInlineBtn.disabled = false
        saveStorageInlineBtn.textContent = 'Save'
      }
    })
  }

  // Handle Enter key in storage name input
  if (newStorageNameInput) {
    newStorageNameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        saveStorageInlineBtn?.click()
      }
    })
  }

  // Create checklist from gear modal
  const createChecklistInModalBtn = document.getElementById('createChecklistInModal')
  const checklistInlineForm = document.getElementById('checklistInlineForm')
  const newChecklistNameInput = document.getElementById('newChecklistName')
  const saveChecklistInlineBtn = document.getElementById('saveChecklistInline')
  const cancelChecklistInlineBtn = document.getElementById('cancelChecklistInline')

  if (createChecklistInModalBtn) {
    createChecklistInModalBtn.addEventListener('click', () => {
      checklistInlineForm.style.display = 'block'
      newChecklistNameInput.focus()
    })
  }

  if (cancelChecklistInlineBtn) {
    cancelChecklistInlineBtn.addEventListener('click', () => {
      checklistInlineForm.style.display = 'none'
      newChecklistNameInput.value = ''
    })
  }

  if (saveChecklistInlineBtn) {
    saveChecklistInlineBtn.addEventListener('click', async () => {
      const checklistName = newChecklistNameInput.value.trim()
      if (!checklistName) return

      try {
        saveChecklistInlineBtn.disabled = true
        saveChecklistInlineBtn.textContent = 'Saving...'

        const newChecklist = {
          id: uid(),
          name: checklistName,
          tags: [],
          startDate: null,
          endDate: null,
          items: [],
          created: Date.now()
        }

        if (SupabaseService.getCurrentUser()) {
          const savedChecklist = await SupabaseService.createChecklist(newChecklist)
          checklists.push(savedChecklist)
        } else {
          checklists.push(newChecklist)
        }

        renderAddToChecklistsSection()

        // Auto-check the newly created checklist
        setTimeout(() => {
          const newCheckbox = document.querySelector(`.add-to-checklist-checkbox[data-checklist-id="${newChecklist.id}"]`)
          if (newCheckbox) {
            newCheckbox.checked = true
          }
        }, 100)

        // Hide form and reset
        checklistInlineForm.style.display = 'none'
        newChecklistNameInput.value = ''
        saveChecklistInlineBtn.disabled = false
        saveChecklistInlineBtn.textContent = 'Save'
      } catch (err) {
        console.error('Error creating checklist:', err)
        alert('Failed to create checklist: ' + err.message)
        saveChecklistInlineBtn.disabled = false
        saveChecklistInlineBtn.textContent = 'Save'
      }
    })
  }

  // Handle Enter key in checklist name input
  if (newChecklistNameInput) {
    newChecklistNameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        saveChecklistInlineBtn?.click()
      }
    })
  }

  closeModalBtn.addEventListener('click', ()=>{
    modal.classList.add('hidden')
    form.reset()
    editingId = null
    currentPhotoData = null
    photoPreview.src = ''
    photoPreview.style.display = 'none'
  })

  modal.addEventListener('click', e=>{
    if(e.target === modal){
      modal.classList.add('hidden')
      form.reset()
      editingId = null
    }
  })

  // initialization - only authenticated users can access data
  async function initializeApp() {
    await initAuth()

    if (!isAuthenticated) {
      // Initialize defaults for non-authenticated users
      loadCategoryOrder()
      // Redirect to auth for non-authenticated users
      showCustomAlert('Sign in to save your gear data and access it from any device.', 'Welcome to AllMyGear')
      return
    }
    // If authenticated, data will be loaded in initAuth -> handleAuthSuccess -> loadFromSupabase
  }

  initializeApp()

  // ==================== CHECKLIST FUNCTIONALITY ====================

  let checklists = []
  let checklistsLoaded = false
  let editingChecklistId = null

  // Outdoor activities database
  const outdoorActivities = [
    // Hiking & Trekking
    'Day Hiking', 'Multi-day Hiking', 'Backpacking', 'Thru-hiking', 'Ultralight Hiking',
    'Mountaineering', 'Alpine Climbing', 'Peak Bagging', 'Via Ferrata', 'Trail Running',

    // Camping
    'Car Camping', 'Backcountry Camping', 'Wild Camping', 'Bikepacking', 'Canoe Camping',
    'Winter Camping', 'Beach Camping', 'Desert Camping', 'Jungle Camping', 'Glamping',

    // Climbing
    'Sport Climbing', 'Trad Climbing', 'Bouldering', 'Ice Climbing', 'Mixed Climbing',
    'Big Wall Climbing', 'Deep Water Soloing', 'Indoor Climbing',

    // Winter Sports
    'Skiing', 'Ski Touring', 'Backcountry Skiing', 'Splitboarding', 'Snowboarding',
    'Cross-country Skiing', 'Ski Mountaineering', 'Snowshoeing', 'Ice Skating',
    'Sledding', 'Snow Camping',

    // Water Sports
    'Kayaking', 'Sea Kayaking', 'Whitewater Kayaking', 'Canoeing', 'Rafting',
    'Stand-up Paddleboarding (SUP)', 'Surfing', 'Windsurfing', 'Kitesurfing',
    'Sailing', 'Swimming', 'Snorkeling', 'Scuba Diving', 'Freediving', 'Spearfishing',

    // Cycling
    'Road Cycling', 'Mountain Biking', 'Gravel Cycling', 'Bikepacking', 'BMX',
    'Downhill Mountain Biking', 'Enduro', 'Trail Riding', 'Fat Biking',

    // Adventure Travel
    'Overlanding', 'Van Life', 'Off-road Driving', 'Motorcycle Adventure', 'Expedition',
    'Desert Expedition', 'Polar Expedition', 'Jungle Expedition',

    // Hunting & Fishing
    'Hunting', 'Bow Hunting', 'Big Game Hunting', 'Bird Hunting', 'Fishing',
    'Fly Fishing', 'Ice Fishing', 'Spearfishing', 'Wildlife Photography',

    // Extreme & Air Sports
    'Paragliding', 'Hang Gliding', 'Skydiving', 'BASE Jumping', 'Wingsuit Flying',
    'Hot Air Ballooning', 'Bungee Jumping', 'Zip Lining',

    // Trail & Endurance
    'Ultramarathon', 'Trail Running', 'Fastpacking', 'Orienteering', 'Rogaining',
    'Adventure Racing',

    // Rock & Cave
    'Canyoning', 'Caving (Spelunking)', 'Coasteering',

    // Survival & Bushcraft
    'Bushcraft', 'Survival Training', 'Wilderness Skills', 'Foraging',

    // Packrafting & River
    'Packrafting', 'River Trekking',

    // Multi-sport
    'Triathlon', 'Duathlon', 'Adventure Racing', 'Obstacle Course Racing',

    // Other
    'Geocaching', 'Birdwatching', 'Stargazing', 'Nature Photography', 'Wilderness First Aid Course',
    'Yoga Retreat', 'Meditation Retreat', 'Volunteering (Conservation)', 'Scientific Expedition'
  ].sort()

  const checklistModal = document.getElementById('checklistModal')
  const checklistModalTitle = document.getElementById('checklistModalTitle')
  const checklistForm = document.getElementById('checklistForm')
  const checklistNameInput = document.getElementById('checklistName')
  const checklistStartDateInput = document.getElementById('checklistStartDate')
  const checklistEndDateInput = document.getElementById('checklistEndDate')
  const newTagInput = document.getElementById('newTagInput')
  const addTagBtn = document.getElementById('addTagBtn')
  const tagsDisplay = document.getElementById('tagsDisplay')
  const categoriesCheckboxesEl = document.getElementById('categoriesCheckboxes')
  const selectAllCategoriesBtn = document.getElementById('selectAllCategories')
  const deselectAllCategoriesBtn = document.getElementById('deselectAllCategories')
  const gearItemsSectionEl = document.getElementById('gearItemsSection')
  const gearItemsCheckboxesEl = document.getElementById('gearItemsCheckboxes')
  const selectAllItemsBtn = document.getElementById('selectAllItems')
  const deselectAllItemsBtn = document.getElementById('deselectAllItems')
  const newChecklistBtn = document.getElementById('newChecklistBtn')
  const closeChecklistModalBtn = document.getElementById('closeChecklistModal')
  const saveChecklistBtn = document.getElementById('saveChecklistBtn')
  const cancelChecklistBtn = document.getElementById('cancelChecklistBtn')
  const checklistCardsEl = document.getElementById('checklistCards')

  // State for checklists expand/collapse
  // Checklist state

  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab

      // Update tab buttons
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
      tab.classList.add('active')

      // Update tab content
      document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'))
      if(targetTab === 'gear'){
        document.getElementById('gearSection').classList.add('active')
        // Check if we're coming from checklists mode
        const isFromChecklists = document.body.classList.contains('checklists-mode')
        document.body.classList.remove('checklists-mode')

        // Only animate if coming from a different mode
        if(isFromChecklists) {
          animateBackgroundTransition([
            {color: '#0f1f1d', position: 0},
            {color: '#1a2f2d', position: 20},
            {color: '#0f1f1d', position: 80},
            {color: '#203733', position: 100}
          ], false)
        }
      } else if(targetTab === 'checklist'){
        document.getElementById('checklistSection').classList.add('active')
        // Check if we're coming from gear mode
        const isFromGear = !document.body.classList.contains('checklists-mode')
        document.body.classList.add('checklists-mode')

        // Only animate if coming from a different mode
        if(isFromGear) {
          animateBackgroundTransition([
            {color: '#2B3A42', position: 0},
            {color: '#1F2D35', position: 20},
            {color: '#2B3A42', position: 80},
            {color: '#1A252C', position: 100}
          ], true)
        }

        // Lazy load checklists on first access
        loadChecklistsIfNeeded()
        renderChecklist()
      }
    })
  })

  // Checklist Order Modal
  function openChecklistOrderModal() {
    if (document.querySelector('.category-order-modal[data-modal-type="checklist"]')) return
    if (checklists.length === 0) return

    const overlay = document.createElement('div')
    overlay.className = 'category-order-modal overlay'
    overlay.dataset.modalType = 'checklist'
    overlay.innerHTML = `
      <div class="category-order-modal-card">
        <div class="modal-header">
          <h3>Edit Checklist Order</h3>
          <button type="button" class="btn icon modal-close" aria-label="Close">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 6 L18 18 M6 18 L18 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <p class="muted">Drag checklists to reorder them.</p>
          <ul class="category-order-list">
            ${checklists.map(cl => `<li data-id="${cl.id}" draggable="true"><span class="co-left"><span class="drag-handle" aria-hidden="true">⋮⋮</span><span class="co-name">${escapeHtml(cl.name)}</span></span></li>`).join('')}
          </ul>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn secondary btn-secondary" data-action="cancel-order">Cancel</button>
          <button type="button" class="btn primary btn-primary" data-action="save-order">Save</button>
        </div>
      </div>`
    document.body.appendChild(overlay)

    // Close on overlay click (outside modal)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeChecklistOrderModal()
    })

    // Close handlers
    overlay.querySelector('.modal-close').addEventListener('click', () => closeChecklistOrderModal())
    overlay.querySelector('[data-action="cancel-order"]').addEventListener('click', () => closeChecklistOrderModal())

    const listEl = overlay.querySelector('.category-order-list')

    // Drag & drop
    function getDragAfterElement(container, y) {
      const draggableElements = [...container.querySelectorAll('li:not(.dragging)')]
      let closest = { offset: Number.NEGATIVE_INFINITY, element: null }
      draggableElements.forEach(child => {
        const box = child.getBoundingClientRect()
        const offset = y - box.top - box.height / 2
        if (offset < 0 && offset > closest.offset) {
          closest = { offset, element: child }
        }
      })
      return closest.element
    }

    listEl.querySelectorAll('li').forEach(li => {
      li.addEventListener('dragstart', (ev) => {
        li.classList.add('dragging')
        ev.dataTransfer.effectAllowed = 'move'
        ev.dataTransfer.setData('text/plain', li.dataset.id)
      })
      li.addEventListener('dragend', () => {
        li.classList.remove('dragging')
      })
      li.addEventListener('dragover', (ev) => {
        ev.preventDefault()
      })
    })

    listEl.addEventListener('dragover', (ev) => {
      ev.preventDefault()
      const dragging = overlay.querySelector('.dragging')
      if (!dragging) return
      const afterElement = getDragAfterElement(listEl, ev.clientY)
      if (!afterElement) {
        listEl.appendChild(dragging)
      } else {
        listEl.insertBefore(dragging, afterElement)
      }
    })

    // Save handler
    overlay.querySelector('[data-action="save-order"]').addEventListener('click', async () => {
      const ul = overlay.querySelector('.category-order-list')
      const newOrder = [...ul.querySelectorAll('li')].map(li => li.dataset.id)

      // Reorder checklists array
      const reorderedChecklists = []
      newOrder.forEach(id => {
        const cl = checklists.find(c => c.id === id)
        if (cl) reorderedChecklists.push(cl)
      })
      checklists = reorderedChecklists

      // Save to Supabase
      if (SupabaseService.getCurrentUser()) {
        try {
          // Update each checklist with new order index
          for (let i = 0; i < checklists.length; i++) {
            checklists[i].orderIndex = i
            await SupabaseService.updateChecklist(checklists[i].id, checklists[i])
          }
        } catch (err) {
          console.error('Error saving checklist order:', err)
        }
      }

      renderChecklist()
      closeChecklistOrderModal()
    })
  }

  function closeChecklistOrderModal() {
    const modal = document.querySelector('.category-order-modal[data-modal-type="checklist"]')
    if (modal) modal.remove()
  }

  // Toggle all checklists expand/collapse
  function toggleAllChecklists() {
    const containers = document.querySelectorAll('.checklist-section .checklist-content')
    if (containers.length === 0) return

    const anyOpen = Array.from(containers).some(c => !c.classList.contains('collapsed'))

    document.querySelectorAll('.checklist-section').forEach(section => {
      const checklistId = section.dataset.checklistId
      const content = section.querySelector('.checklist-content')
      const chevron = section.querySelector('.checklist-toggle-btn .cat-chevron')

      if (anyOpen) {
        content.classList.add('collapsed')
        checklistCollapsedState[checklistId] = true
        if (chevron) chevron.style.transform = 'rotate(180deg)'
      } else {
        content.classList.remove('collapsed')
        checklistCollapsedState[checklistId] = false
        if (chevron) chevron.style.transform = 'rotate(0deg)'
      }
    })
  }

  function renderChecklist(){
    checklistCardsEl.innerHTML = ''

    if(checklists.length === 0){
      checklistCardsEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)"><p>No checklists yet. Create one to start planning your trip!</p></div>'
      return
    }

    // Insert checklist-order toolbar (same as gear) before checklists
    const toolbar = document.createElement('div')
    toolbar.className = 'category-order-toolbar'
    toolbar.innerHTML = `
      <div class="toolbar-search-wrapper">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <path d="m21 21-4.35-4.35"/>
        </svg>
        <input id="checklistSearch" type="search" placeholder="Search checklists...">
      </div>
      <div class="category-order-toolbar-inner">
        <button class="category-edit-order-btn" title="Edit checklist order" aria-label="Edit checklist order">
          <svg width="18" height="12" viewBox="0 0 18 12" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M2 2h14M2 6h14M2 10h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>
          </svg>
        </button>
        <button class="category-toggle-all-btn" title="Toggle all checklists" aria-label="Toggle all checklists">
          <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M12 5l4 4H8l4-4zm0 14l-4-4h8l-4 4z" fill="currentColor"/>
          </svg>
        </button>
      </div>`
    checklistCardsEl.appendChild(toolbar)

    // Setup checklist search functionality
    const checklistSearchInput = toolbar.querySelector('#checklistSearch')
    if (checklistSearchInput) {
      const filterChecklists = () => {
        const query = checklistSearchInput.value.toLowerCase().trim()
        document.querySelectorAll('.checklist-section').forEach(section => {
          const name = section.querySelector('.cat-title')?.textContent?.toLowerCase() || ''
          const tags = Array.from(section.querySelectorAll('.tag')).map(t => t.textContent.toLowerCase()).join(' ')
          const matches = !query || name.includes(query) || tags.includes(query)
          section.style.display = matches ? '' : 'none'
        })
      }

      checklistSearchInput.addEventListener('input', filterChecklists)
      // Handle clearing search via X button in type="search"
      checklistSearchInput.addEventListener('search', filterChecklists)
    }

    // Attach event listeners to toolbar buttons
    const editOrderBtn = toolbar.querySelector('.category-edit-order-btn')
    if (editOrderBtn) {
      editOrderBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        openChecklistOrderModal()
      })
    }

    const toggleAllBtn = toolbar.querySelector('.category-toggle-all-btn')
    if (toggleAllBtn) {
      toggleAllBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        toggleAllChecklists()
      })
    }

    // Render each checklist as a top-level collapsible section
    checklists.forEach(checklist => {
      const checklistItemIds = checklist.items.map(it => it.itemId)
      let checklistItems = items.filter(it => checklistItemIds.includes(it.id))

      // Apply storage filter if set for this checklist
      const storageFilter = currentChecklistStorageFilter[checklist.id]
      if (storageFilter) {
        checklistItems = checklistItems.filter(it => it.storageId === storageFilter)
      }

      const totalCount = checklistItems.length
      const checkedCount = checklistItems.filter(it => {
        const ci = checklist.items.find(ci => ci.itemId === it.id)
        return ci && ci.checked
      }).length
      const totalWeight = checklistItems.reduce((s, i) => s + (Number(i.weight) || 0), 0)

      // Format dates for display
      const formatDate = (dateStr) => {
        if (!dateStr) return null
        const date = new Date(dateStr)
        return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      }

      let datesHtml = ''
      if (checklist.startDate || checklist.endDate) {
        const start = formatDate(checklist.startDate)
        const end = formatDate(checklist.endDate)
        if (start && end) {
          datesHtml = `<span class="checklist-dates">${start} — ${end}</span>`
        } else if (start) {
          datesHtml = `<span class="checklist-dates">From ${start}</span>`
        } else if (end) {
          datesHtml = `<span class="checklist-dates">Until ${end}</span>`
        }
      }

      // Create checklist section (like category section)
      const checklistSection = document.createElement('div')
      checklistSection.className = 'checklist-section'
      checklistSection.dataset.checklistId = checklist.id

      const checklistHeader = document.createElement('div')
      checklistHeader.className = 'checklist-header' + (totalCount > 0 && checkedCount === totalCount ? ' complete' : '')
      const canEditChecklist = canEditResource(checklist)

      const tagsHtml = checklist.tags && checklist.tags.length > 0
        ? `<div class="checklist-tags">${checklist.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>`
        : ''

      // Check if items are from different storages
      const storageIds = new Set(checklistItems.filter(it => it.storageId).map(it => it.storageId))
      const hasMultipleStorages = storageIds.size > 1
      const storageWarningHtml = hasMultipleStorages
        ? `<svg class="storage-warning-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" title="Items from different storage locations">
             <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" fill="currentColor"/>
           </svg>`
        : ''

      const datesAndTagsHtml = (datesHtml || tagsHtml)
        ? `<div class="checklist-meta-row">${datesHtml}${tagsHtml}</div>`
        : ''

      checklistHeader.innerHTML = `
        <div style="display:flex;align-items:center;width:100%;flex-wrap:wrap;gap:12px;">
          <button class="checklist-toggle-btn" data-checklist-id="${checklist.id}" style="flex:1 1 300px;min-width:0;background:none;border:none;cursor:pointer;text-align:left;padding:0;">
            <div class="checklist-title-row">
              <div class="checklist-title-with-activities">
                <span class="cat-title">${escapeHtml(checklist.name)}</span>
                ${renderVisibilityBadges(checklist)}
                ${datesAndTagsHtml}
              </div>
              <svg class="cat-chevron" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M7 14l5-5 5 5z"/>
              </svg>
            </div>
          </button>
          ${hasMultipleStorages ? `
            <div class="storage-warning-wrapper" title="Items from ${storageIds.size} different storage locations">
              <svg class="storage-warning-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" fill="currentColor"/>
              </svg>
            </div>
          ` : ''}
          <div class="category-stats" style="flex:0 1 auto;">
            ${storages.length > 0 ? `
              <select class="checklist-storage-filter" data-checklist-id="${checklist.id}" title="Filter by storage">
                <option value="">All storages</option>
                ${storages.map(st => {
                  const selected = currentChecklistStorageFilter[checklist.id] === st.id ? 'selected' : ''
                  return `<option value="${st.id}" ${selected}>${escapeHtml(st.name)}</option>`
                }).join('')}
              </select>
            ` : ''}
            ${canEditChecklist && checkedCount === totalCount && totalCount > 0 ? `
              <button class="btn icon clear-all" data-action="clear-all-checks" data-id="${checklist.id}" title="Uncheck all items">
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </button>
            ` : ''}
            ${canEditChecklist ? `
            <button class="btn icon" data-action="edit-checklist" data-id="${checklist.id}" title="Edit checklist">
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
              </svg>
            </button>
            ` : ''}
            <button class="btn icon" data-action="share-checklist" data-id="${checklist.id}" title="Share checklist">
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z"/>
              </svg>
            </button>
            <button class="btn icon" data-action="copy-checklist" data-id="${checklist.id}" title="Copy checklist">
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
              </svg>
            </button>
            ${canEditChecklist ? `
            <button class="btn icon delete" data-action="delete-checklist" data-id="${checklist.id}" title="Delete checklist">
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
              </svg>
            </button>
            ` : ''}
            <span class="stat">${checkedCount}/${totalCount}</span>
            <span class="stat">${formatWeight(totalWeight)}</span>
          </div>
        </div>
      `

      // Container for categories within this checklist
      const checklistContent = document.createElement('div')
      const isCollapsed = appHelpers.shouldCollapseChecklist(checklistCollapsedState, checklist.id)
      checklistContent.className = 'checklist-content' + (isCollapsed ? ' collapsed' : '')

      if(checklistItems.length === 0){
        checklistContent.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:14px"><p>No items in this checklist</p></div>'
      } else {
        // Group by category
        const grouped = {}
        const uncategorizedItems = []
        checklistItems.forEach(it => {
          if(!it.category || it.category === ''){
            uncategorizedItems.push(it)
          } else {
            if(!grouped[it.category]) grouped[it.category] = []
            grouped[it.category].push(it)
          }
        })

        // Render uncategorized items first
        uncategorizedItems.forEach(it => {
          const checklistItem = checklist.items.find(ci => ci.itemId === it.id)
          const el = createChecklistCard(it, checklistItem, canEditChecklist)
          checklistContent.appendChild(el)
        })

        // Render each category section
        categoryOrder.forEach(catName => {
          const catItems = grouped[catName] || []
          if(catItems.length === 0) return

          const catCount = catItems.length
          const catWeight = catItems.reduce((s, i) => s + (Number(i.weight) || 0), 0)
          const catPrice = catItems.reduce((s, i) => s + (Number(i.price) || 0), 0)
          const catCheckedCount = catItems.filter(i => {
            const ci = checklist.items.find(ci => ci.itemId === i.id)
            return ci && ci.checked
          }).length

          const catSection = document.createElement('div')
          catSection.className = 'category-section'
          catSection.dataset.category = catName
          catSection.dataset.checklistId = checklist.id

          // Get saved sort state for this checklist+category
          if (!checklistCategorySortState[checklist.id]) {
            checklistCategorySortState[checklist.id] = {}
          }
          if (!checklistCategorySortState[checklist.id][catName]) {
            checklistCategorySortState[checklist.id][catName] = {type: 'name', order: 'asc'}
          }
          const savedSort = checklistCategorySortState[checklist.id][catName]

          const sortLabels = {
            name: 'Name',
            weight: 'Weight',
            price: 'Price',
            year: 'Year',
            rating: 'Rating'
          }

          const catHeader = document.createElement('div')
          catHeader.className = 'category-header'
          catHeader.innerHTML = `
            <div class="category-left">
              <button class="category-toggle" data-action="toggle-category-group" data-category="${escapeHtml(catName)}">
                <span class="cat-title">${escapeHtml(catName)}</span>
                <svg class="cat-chevron" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="transform:rotate(180deg)">
                  <path d="M7 14l5-5 5 5z"/>
                </svg>
              </button>
            </div>
            <div class="category-controls">
              ${catItems.length > 0 ? `
              <div class="category-sort-wrapper" data-category="${escapeHtml(catName)}" data-checklist-id="${checklist.id}">
                <button class="category-sort-order-btn checklist-sort-order" data-category="${escapeHtml(catName)}" data-checklist-id="${checklist.id}" data-order="${savedSort.order}" title="Toggle sort order">
                  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" class="icon-asc" style="${savedSort.order === 'asc' ? '' : 'display:none'}">
                    <path d="M3 6h6v2H3V6zm0 12v-2h18v2H3zm0-7h12v2H3v-2z"/>
                  </svg>
                  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" class="icon-desc" style="${savedSort.order === 'desc' ? '' : 'display:none'}">
                    <path d="M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z"/>
                  </svg>
                </button>
                <button class="category-sort-type-btn checklist-sort-type" data-category="${escapeHtml(catName)}" data-checklist-id="${checklist.id}" title="Choose sort type">
                  <span class="sort-label">${sortLabels[savedSort.type]}</span>
                </button>
                <select class="category-sort-select checklist-sort-select" data-category="${escapeHtml(catName)}" data-checklist-id="${checklist.id}">
                  <option value="name" ${savedSort.type === 'name' ? 'selected' : ''}>Name</option>
                  <option value="weight" ${savedSort.type === 'weight' ? 'selected' : ''}>Weight</option>
                  <option value="price" ${savedSort.type === 'price' ? 'selected' : ''}>Price</option>
                  <option value="year" ${savedSort.type === 'year' ? 'selected' : ''}>Year</option>
                  <option value="rating" ${savedSort.type === 'rating' ? 'selected' : ''}>Rating</option>
                </select>
              </div>
              ` : ''}
              <div class="category-stats">
                <span class="stat">${catItems.length}</span>
                <span class="stat">${formatWeight(catItems.reduce((s, i) => s + (Number(i.weight) || 0), 0))}</span>
              </div>
            </div>
          `

          const itemsContainer = document.createElement('div')
          itemsContainer.className = 'category-items'
          itemsContainer.dataset.category = catName

          // Apply saved sort to items before rendering
          const sortedCatItems = [...catItems]
          sortedCatItems.sort((a, b) => {
            let result = 0
            switch(savedSort.type) {
              case 'weight':
                result = (Number(a.weight) || 0) - (Number(b.weight) || 0)
                break
              case 'price':
                result = (Number(a.price) || 0) - (Number(b.price) || 0)
                break
              case 'year':
                result = (Number(a.year) || 0) - (Number(b.year) || 0)
                break
              case 'rating':
                result = (Number(a.rating) || 0) - (Number(b.rating) || 0)
                break
              case 'name':
              default:
                result = a.name.localeCompare(b.name)
            }
            return savedSort.order === 'asc' ? result : -result
          })

          sortedCatItems.forEach(it => {
            const checklistItem = checklist.items.find(ci => ci.itemId === it.id)
            const el = createChecklistCard(it, checklistItem, canEditChecklist)
            itemsContainer.appendChild(el)
          })

          catSection.appendChild(catHeader)
          catSection.appendChild(itemsContainer)

          // Make clicking anywhere on the category header toggle collapse/expand
          catHeader.addEventListener('click', (e) => {
            // Ignore clicks on interactive controls inside header
            if (e.target.closest('button') || e.target.closest('select') || e.target.closest('input') || e.target.closest('a')) return

            const chevron = catSection.querySelector('.cat-chevron')
            itemsContainer.classList.toggle('collapsed')
            if(itemsContainer.classList.contains('collapsed')){
              chevron.style.transform = 'rotate(180deg)'
            } else {
              chevron.style.transform = 'rotate(0deg)'
            }
          })

          checklistContent.appendChild(catSection)
        })
      }

      checklistSection.appendChild(checklistHeader)
      checklistSection.appendChild(checklistContent)
      checklistCardsEl.appendChild(checklistSection)
    })
  }

  function createChecklistCard(item, checklistItem, canEditChecklist = true){
    const el = document.createElement('article')
    el.className = 'card checklist-card' + (checklistItem && checklistItem.checked ? ' checked' : '')
    el.dataset.id = item.id

    const imgHtml = item.image ? `<img class="thumb" src="${item.image}" alt="${escapeHtml(item.name)}" loading="lazy">` : ''
    const largeImgHtml = item.image ? `<img src="${item.image}" alt="${escapeHtml(item.name)}" loading="lazy">` : 'No photo'

    const storageName = item.storageId ? storages.find(s => s.id === item.storageId)?.name : null
    const storageBadgeHtml = storageName ? `<span class="storage-badge-large">${escapeHtml(storageName)}</span>` : ''

    el.innerHTML = `
      <div class="card-compact-content">
        ${imgHtml}
        <div class="left">
          <div class="card-header">
            <h3 title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</h3>
          </div>
          <div class="card-footer">
            <div class="attrs">
              <span>${escapeHtml(item.brand || '-')}</span>
              <span>${escapeHtml(item.model || '-')}</span>
            </div>
          </div>
        </div>
        ${storageBadgeHtml}
        <div class="weight-badge">${formatWeight(item.weight)}</div>
        <div class="card-checkbox-right">
          ${canEditChecklist ? `
          <button class="btn icon remove-from-checklist" data-item-id="${item.id}" title="Remove from checklist">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width:16px;height:16px;">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
          ` : ''}
          <input type="checkbox" ${checklistItem && checklistItem.checked ? 'checked' : ''} data-item-id="${item.id}" ${canEditChecklist ? '' : 'disabled'}>
        </div>
      </div>
      <div class="card-expanded-content">
        <div class="card-expanded-header">
          <div class="card-expanded-photo">
            <div class="photo-container">${largeImgHtml}</div>
          </div>
          <div class="card-expanded-info">
            <h3 class="card-expanded-title">${escapeHtml(item.name)}</h3>
            ${item.brand ? `<div class="card-expanded-brand">${escapeHtml(item.brand)} ${item.model ? escapeHtml(item.model) : ''}</div>` : ''}
            <div class="card-expanded-details">
              <div class="card-expanded-detail weight-detail">
                <div class="card-expanded-detail-label">Weight</div>
                <div class="card-expanded-detail-value weight-value">${formatWeight(item.weight)}</div>
              </div>
              ${item.price ? `
              <div class="card-expanded-detail">
                <div class="card-expanded-detail-label">Price</div>
                <div class="card-expanded-detail-value">${formatPrice(item.price)}</div>
              </div>` : ''}
              ${item.year ? `
              <div class="card-expanded-detail">
                <div class="card-expanded-detail-label">Year of purchase</div>
                <div class="card-expanded-detail-value">${item.year}</div>
              </div>` : ''}
              ${item.rating ? `
              <div class="card-expanded-detail">
                <div class="card-expanded-detail-label">Level of satisfaction</div>
                <div class="card-expanded-detail-value">${'★'.repeat(item.rating)}${'☆'.repeat(5-item.rating)}</div>
              </div>` : ''}
            </div>
          </div>
        </div>
        <div class="card-checkbox-right expanded-checkbox">
          ${canEditChecklist ? `
          <button class="btn icon remove-from-checklist" data-item-id="${item.id}" title="Remove from checklist">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width:16px;height:16px;">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
          ` : ''}
          <input type="checkbox" ${checklistItem && checklistItem.checked ? 'checked' : ''} data-item-id="${item.id}" ${canEditChecklist ? '' : 'disabled'}>
        </div>
      </div>
    `

    return el
  }

  // Checklist category sort handler via select dropdown
  checklistCardsEl.addEventListener('change', async (e) => {
    // Handle storage filter change
    if (e.target.classList.contains('checklist-storage-filter')) {
      e.stopPropagation() // Prevent checklist from collapsing
      const checklistId = e.target.dataset.checklistId
      const storageId = e.target.value

      // Save category states before re-rendering
      const categoryStates = {}

      document.querySelectorAll('.checklist-section').forEach(section => {
        const sectionId = section.dataset.checklistId

        // Save category states within this checklist
        const categoryElements = section.querySelectorAll('.category-section')
        categoryStates[sectionId] = {}
        categoryElements.forEach(catEl => {
          const category = catEl.dataset.category
          const itemsContainer = catEl.querySelector('.category-items')
          if (itemsContainer && category) {
            categoryStates[sectionId][category] = itemsContainer.classList.contains('collapsed')
          }
        })
      })

      // Update filter state
      currentChecklistStorageFilter[checklistId] = storageId || null

      // Re-render checklist with filter applied
      renderChecklist()

      // Restore category states after re-rendering (checklist states are now applied during render)
      setTimeout(() => {
        Object.keys(categoryStates).forEach(sectionId => {
          const section = document.querySelector(`.checklist-section[data-checklist-id="${sectionId}"]`)
          if (section && categoryStates[sectionId]) {
            Object.keys(categoryStates[sectionId]).forEach(category => {
              const catEl = section.querySelector(`.category-section[data-category="${category}"]`)
              if (catEl) {
                const itemsContainer = catEl.querySelector('.category-items')
                const chevron = catEl.querySelector('.cat-chevron')
                if (itemsContainer && categoryStates[sectionId][category]) {
                  itemsContainer.classList.add('collapsed')
                  if (chevron) {
                    chevron.style.transform = 'rotate(180deg)'
                  }
                } else if (itemsContainer && !categoryStates[sectionId][category]) {
                  itemsContainer.classList.remove('collapsed')
                  if (chevron) {
                    chevron.style.transform = 'rotate(0deg)'
                  }
                }
              }
            })
          }
        })
      }, 0)

      return
    }

    if (e.target.classList.contains('checklist-sort-select')) {
      const category = e.target.dataset.category
      const checklistId = e.target.dataset.checklistId
      const sortOption = e.target.value
      const categorySection = e.target.closest('.category-section')
      const itemsContainer = categorySection.querySelector('.category-items')
      const cards = Array.from(itemsContainer.querySelectorAll('.card'))

      // Initialize state objects if needed
      if (!checklistCategorySortState[checklistId]) {
        checklistCategorySortState[checklistId] = {}
      }
      if (!checklistCategorySortState[checklistId][category]) {
        checklistCategorySortState[checklistId][category] = {type: 'name', order: 'asc'}
      }

      // Update saved state
      checklistCategorySortState[checklistId][category].type = sortOption

      // Update button label
      const wrapper = categorySection.querySelector('.category-sort-wrapper')
      const typeBtn = wrapper.querySelector('.category-sort-type-btn')
      const sortLabels = {
        name: 'Name',
        weight: 'Weight',
        price: 'Price',
        year: 'Year',
        rating: 'Rating'
      }
      if (typeBtn) {
        const label = typeBtn.querySelector('.sort-label')
        if (label) label.textContent = sortLabels[sortOption]
      }

      // Sort cards
      const orderBtn = wrapper.querySelector('.category-sort-order-btn')
      const currentOrder = orderBtn ? (orderBtn.dataset.order || 'asc') : 'asc'
      cards.sort((a, b) => {
        const itemA = items.find(it => it.id === a.dataset.id)
        const itemB = items.find(it => it.id === b.dataset.id)

        let result = 0
        switch(sortOption) {
          case 'weight':
            result = (Number(itemA.weight) || 0) - (Number(itemB.weight) || 0)
            break
          case 'price':
            result = (Number(itemA.price) || 0) - (Number(itemB.price) || 0)
            break
          case 'year':
            result = (Number(itemA.year) || 0) - (Number(itemB.year) || 0)
            break
          case 'rating':
            result = (Number(itemA.rating) || 0) - (Number(itemB.rating) || 0)
            break
          case 'name':
          default:
            result = itemA.name.localeCompare(itemB.name)
        }

        return currentOrder === 'asc' ? result : -result
      })

      // Re-append in sorted order
      cards.forEach(card => itemsContainer.appendChild(card))

      // Update checklist items order
      const checklist = checklists.find(c => c.id === checklistId)
      if (checklist && canEditResource(checklist)) {
        const sortedItemIds = cards.map(card => card.dataset.id)
        const categoryChecklistItems = checklist.items.filter(ci => {
          const item = items.find(it => it.id === ci.itemId)
          return item && item.category === category
        })

        categoryChecklistItems.sort((a, b) => {
          return sortedItemIds.indexOf(a.itemId) - sortedItemIds.indexOf(b.itemId)
        })

        // Rebuild checklist items array
        const otherChecklistItems = checklist.items.filter(ci => {
          const item = items.find(it => it.id === ci.itemId)
          return !item || item.category !== category
        })

        checklist.items = [...otherChecklistItems, ...categoryChecklistItems]

        // Save to Supabase
        if (SupabaseService.getCurrentUser()) {
          await SupabaseService.updateChecklist(checklistId, checklist)
        }
      }

      e.target.blur()
      return
    }

    if(e.target.matches('input[type="checkbox"]')){
      const itemId = e.target.dataset.itemId
      const checked = e.target.checked

      // Find which checklist this item belongs to
      const card = e.target.closest('.card')
      const catSection = card.closest('.category-section')
      const checklistId = catSection ? catSection.dataset.checklistId : null

      // Sync both checkboxes in the card (compact and expanded views)
      const allCheckboxes = card.querySelectorAll(`input[type="checkbox"][data-item-id="${itemId}"]`)
      allCheckboxes.forEach(cb => {
        if (cb !== e.target) {
          cb.checked = checked
        }
      })

      // Toggle card checked state visually
      if (checked) {
        card.classList.add('checked')
      } else {
        card.classList.remove('checked')
      }

      if(checklistId){
        const checklist = checklists.find(c => c.id === checklistId)
        if(checklist){
          if (!canEditResource(checklist)) {
            e.target.checked = !checked
            alertOwnerOnly('checklists')
            return
          }
          const item = checklist.items.find(i => i.itemId === itemId)
          if(item){
            item.checked = checked

            // Update checklist in Supabase
            if (SupabaseService.getCurrentUser()) {
              SupabaseService.updateChecklist(checklistId, checklist).catch(err => {
                console.error('Error updating checklist:', err)
              })
            }

            // Move checked cards to bottom
            if (catSection) {
              const categoryItems = catSection.querySelector('.category-items')
              if (categoryItems) {
                const allCards = Array.from(categoryItems.querySelectorAll('.card.checklist-card'))

                // Sort cards: unchecked first, checked last
                allCards.sort((a, b) => {
                  const aChecked = a.classList.contains('checked')
                  const bChecked = b.classList.contains('checked')
                  if (aChecked === bChecked) return 0
                  return aChecked ? 1 : -1
                })

                // Re-append cards in sorted order
                allCards.forEach(card => categoryItems.appendChild(card))
              }
            }

            // Update checklist stats without full re-render
            const checklistSection = card.closest('.checklist-section')
            if (checklistSection) {
              const allCards = checklistSection.querySelectorAll('.checklist-card')
              const checkedCount = checklistSection.querySelectorAll('.checklist-card.checked').length
              const totalCount = allCards.length
              const checkedPercent = totalCount > 0 ? Math.round((checkedCount / totalCount) * 100) : 0

              const progressFill = checklistSection.querySelector('.checklist-progress-fill')
              const progressText = checklistSection.querySelector('.checklist-progress-text')
              const checklistHeader = checklistSection.querySelector('.checklist-header')
              const categoryStats = checklistSection.querySelector('.category-stats')

              if (progressFill) {
                progressFill.style.width = checkedPercent + '%'
              }
              if (progressText) {
                progressText.textContent = `${checkedCount}/${totalCount}`
              }

              // Update stats in header (checkedCount/totalCount)
              if (categoryStats) {
                const statElements = categoryStats.querySelectorAll('.stat')
                if (statElements.length > 0) {
                  statElements[0].textContent = `${checkedCount}/${totalCount}`
                }
              }

              // Update complete status on checklist header
              if (checklistHeader) {
                if (totalCount > 0 && checkedCount === totalCount) {
                  checklistHeader.classList.add('complete')
                } else {
                  checklistHeader.classList.remove('complete')
                }
              }

              // Update clear-all button visibility
              if (categoryStats) {
                let clearBtn = categoryStats.querySelector('.clear-all')
                if (totalCount > 0 && checkedCount === totalCount) {
                  // Show clear button if not exists
                  if (!clearBtn) {
                    clearBtn = document.createElement('button')
                    clearBtn.className = 'btn icon clear-all'
                    clearBtn.dataset.action = 'clear-all-checks'
                    clearBtn.dataset.id = checklistId
                    clearBtn.title = 'Uncheck all items'
                    clearBtn.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                    </svg>`
                    categoryStats.insertBefore(clearBtn, categoryStats.firstChild)
                  }
                } else {
                  // Hide clear button if exists
                  if (clearBtn) {
                    clearBtn.remove()
                  }
                }
              }
            }
          }
        }
      }
    }
  })

  // Removed old checklist drag and drop functionality
  // Now using modal-based reordering instead

  // Handle checklist card expansion (click on card, not on interactive elements)
  checklistCardsEl.addEventListener('click', e => {
    // Ignore clicks on interactive elements
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select') || e.target.closest('a')) {
      return
    }

    const card = e.target.closest('.checklist-card')
    if (!card) return

    // Toggle expansion with animation
    if (card.classList.contains('expanded')) {
      // Collapsing - add collapsing class and wait for animation
      card.classList.add('collapsing')

      setTimeout(() => {
        card.classList.remove('expanded', 'collapsing')
      }, 400) // Match animation duration
    } else {
      // Collapse other expanded cards in the same category
      const categorySection = card.closest('.category-section')
      if (categorySection) {
        const expandedCards = categorySection.querySelectorAll('.checklist-card.expanded')
        expandedCards.forEach(c => {
          c.classList.remove('expanded')
        })
      }
      // Expanding - just add expanded class
      card.classList.add('expanded')
    }
  })

  // Checklist toggle handler (left part of header with title and chevron)
  checklistCardsEl.addEventListener('click', e => {
    const toggleBtn = e.target.closest('.checklist-toggle-btn')
    if (!toggleBtn) return

    const checklistSection = toggleBtn.closest('.checklist-section')
    if (!checklistSection) return

    const checklistId = checklistSection.dataset.checklistId
    const content = checklistSection.querySelector('.checklist-content')
    const chevron = toggleBtn.querySelector('.cat-chevron')

    if (content) {
      content.classList.toggle('collapsed')
      const isNowCollapsed = content.classList.contains('collapsed')

      // Save state
      checklistCollapsedState[checklistId] = isNowCollapsed

      if (chevron) {
        chevron.style.transform = isNowCollapsed ? 'rotate(180deg)' : 'rotate(0deg)'
      }
    }
  })

  // Card, category actions and other button handlers
  checklistCardsEl.addEventListener('click', e => {
    // If click is on select element, ignore it (handled by change event)
    if (e.target.tagName === 'SELECT' || e.target.closest('select')) {
      return
    }

    const btn = e.target.closest('button[data-action]')
    if (!btn) return

    const action = btn.dataset.action

    // Handle checklist sort order button
    const checklistOrderBtn = e.target.closest('.checklist-sort-order')
    if (checklistOrderBtn) {
      e.stopPropagation()
      e.preventDefault()

      const categorySection = checklistOrderBtn.closest('.category-section')
      const category = categorySection.dataset.category
      const checklistId = categorySection.dataset.checklistId

      // Initialize state objects if needed
      if (!checklistCategorySortState[checklistId]) {
        checklistCategorySortState[checklistId] = {}
      }
      if (!checklistCategorySortState[checklistId][category]) {
        checklistCategorySortState[checklistId][category] = {type: 'name', order: 'asc'}
      }

      // Toggle order
      const currentOrder = checklistOrderBtn.dataset.order || 'asc'
      const newOrder = currentOrder === 'asc' ? 'desc' : 'asc'
      checklistOrderBtn.dataset.order = newOrder

      // Update saved state
      checklistCategorySortState[checklistId][category].order = newOrder

      // Toggle icons
      const iconAsc = checklistOrderBtn.querySelector('.icon-asc')
      const iconDesc = checklistOrderBtn.querySelector('.icon-desc')
      if (iconAsc && iconDesc) {
        if (newOrder === 'asc') {
          iconAsc.style.display = 'block'
          iconDesc.style.display = 'none'
        } else {
          iconAsc.style.display = 'none'
          iconDesc.style.display = 'block'
        }
      }

      // Re-sort with new order
      const itemsContainer = categorySection.querySelector('.category-items')
      const cards = Array.from(itemsContainer.querySelectorAll('.card'))
      const select = categorySection.querySelector('.checklist-sort-select')
      const sortOption = select.value

      cards.sort((a, b) => {
        const itemA = items.find(it => it.id === a.dataset.id)
        const itemB = items.find(it => it.id === b.dataset.id)

        let result = 0
        switch(sortOption) {
          case 'weight':
            result = (Number(itemA.weight) || 0) - (Number(itemB.weight) || 0)
            break
          case 'price':
            result = (Number(itemA.price) || 0) - (Number(itemB.price) || 0)
            break
          case 'year':
            result = (Number(itemA.year) || 0) - (Number(itemB.year) || 0)
            break
          case 'rating':
            result = (Number(itemA.rating) || 0) - (Number(itemB.rating) || 0)
            break
          case 'name':
          default:
            result = itemA.name.localeCompare(itemB.name)
        }

        return newOrder === 'asc' ? result : -result
      })

      cards.forEach(card => itemsContainer.appendChild(card))

      // Update checklist items order
      const checklist = checklists.find(c => c.id === checklistId)
      if (checklist && canEditResource(checklist)) {
        const sortedItemIds = cards.map(card => card.dataset.id)
        const categoryChecklistItems = checklist.items.filter(ci => {
          const item = items.find(it => it.id === ci.itemId)
          return item && item.category === category
        })

        categoryChecklistItems.sort((a, b) => {
          return sortedItemIds.indexOf(a.itemId) - sortedItemIds.indexOf(b.itemId)
        })

        const otherChecklistItems = checklist.items.filter(ci => {
          const item = items.find(it => it.id === ci.itemId)
          return !item || item.category !== category
        })

        checklist.items = [...otherChecklistItems, ...categoryChecklistItems]

        // Save to Supabase
        if (SupabaseService.getCurrentUser()) {
          SupabaseService.updateChecklist(checklistId, checklist).catch(err => {
            console.error('Error updating checklist:', err)
          })
        }
      }

      return
    }

    // Handle checklist sort type button
    const checklistTypeBtn = e.target.closest('.checklist-sort-type')
    if (checklistTypeBtn) {
      e.stopPropagation()
      e.preventDefault()

      const wrapper = checklistTypeBtn.closest('.category-sort-wrapper')
      const select = wrapper.querySelector('.checklist-sort-select')
      if (select) {
        select.focus()
        select.click()
      }
      return
    }

    // Handle remove item from checklist
    if(btn.classList.contains('remove-from-checklist')) {
      e.stopPropagation()
      const itemId = btn.dataset.itemId
      const checklistSection = btn.closest('.checklist-section')
      const checklistId = checklistSection.dataset.checklistId

      // Save category collapsed states before re-rendering
      const categoryStates = {}

      // Save category states within checklists
      document.querySelectorAll('.checklist-section').forEach(section => {
        const sectionId = section.dataset.checklistId

        // Save category states within this checklist
        const categoryElements = section.querySelectorAll('.category-section')
        categoryStates[sectionId] = {}
        categoryElements.forEach(catEl => {
          const category = catEl.dataset.category
          const itemsContainer = catEl.querySelector('.category-items')
          if (itemsContainer && category) {
            categoryStates[sectionId][category] = itemsContainer.classList.contains('collapsed')
          }
        })
      })

      const checklist = checklists.find(c => c.id === checklistId)
      if(checklist) {
        if (!canEditResource(checklist)) {
          alertOwnerOnly('checklists')
          return
        }
        checklist.items = checklist.items.filter(item => item.itemId !== itemId)

        // Update checklist in Supabase
        if (SupabaseService.getCurrentUser()) {
          SupabaseService.updateChecklist(checklistId, checklist).catch(err => {
            console.error('Error updating checklist:', err)
          })
        }

        renderChecklist()

        // Restore category collapsed states after re-rendering (checklist states are now applied during render)
        setTimeout(() => {
          // Restore category states
          Object.keys(categoryStates).forEach(sectionId => {
            const section = document.querySelector(`.checklist-section[data-checklist-id="${sectionId}"]`)
            if (section && categoryStates[sectionId]) {
              Object.keys(categoryStates[sectionId]).forEach(category => {
                const catEl = section.querySelector(`.category-section[data-category="${category}"]`)
                if (catEl) {
                  const itemsContainer = catEl.querySelector('.category-items')
                  const chevron = catEl.querySelector('.cat-chevron')
                  if (itemsContainer && categoryStates[sectionId][category]) {
                    itemsContainer.classList.add('collapsed')
                    if (chevron) {
                      chevron.style.transform = 'rotate(180deg)'
                    }
                  } else if (itemsContainer && !categoryStates[sectionId][category]) {
                    itemsContainer.classList.remove('collapsed')
                    if (chevron) {
                      chevron.style.transform = 'rotate(0deg)'
                    }
                  }
                }
              })
            }
          })
        }, 0)
      }
      return
    }

    if(action === 'toggle-category-group'){
      const catSection = e.target.closest('.category-section')
      if(catSection){
        const itemsContainer = catSection.querySelector('.category-items')
        const chevron = catSection.querySelector('.cat-chevron')
        itemsContainer.classList.toggle('collapsed')
        if(itemsContainer.classList.contains('collapsed')){
          chevron.style.transform = 'rotate(180deg)'
        } else {
          chevron.style.transform = 'rotate(0deg)'
        }
      }
    } else if(action === 'edit-checklist'){
      if (!SupabaseService.getCurrentUser()) {
        alert('Please sign in to edit checklists')
        return
      }

      const id = btn.dataset.id
      const cl = checklists.find(c => c.id === id)

      if(cl){
        if (!canEditResource(cl)) {
          alertOwnerOnly('checklists')
          return
        }
        editingChecklistId = id
        if(checklistModalTitle) checklistModalTitle.textContent = 'Edit Checklist'
        const subtitle = document.querySelector('.modal-subtitle')
        if(subtitle) subtitle.textContent = 'Update your gear checklist'
        if(saveChecklistBtn) saveChecklistBtn.textContent = 'Save Changes'
        if(checklistNameInput) checklistNameInput.value = cl.name
        if(checklistStartDateInput) checklistStartDateInput.value = cl.startDate || ''
        if(checklistEndDateInput) checklistEndDateInput.value = cl.endDate || ''
        currentTags = [...(cl.tags || [])]
        renderTags()

        // Get selected categories and items
        const itemIds = cl.items.map(item => item.itemId)
        const selectedItems = items.filter(item => itemIds.includes(item.id))
        const selectedCategories = [...new Set(selectedItems.map(item => item.category))]

        renderCategoryCheckboxes(selectedCategories)
        renderGearItems(selectedCategories, itemIds)
        renderVisibilityPicker('checklistVisibilityPicker', cl)

        if(checklistModal) checklistModal.classList.remove('hidden')
      }
      return
    }

    if(action === 'share-checklist'){
      if (!SupabaseService.getCurrentUser()) {
        alert('Please sign in to share checklists')
        return
      }

      const id = btn.dataset.id
      const checklist = checklists.find(c => c.id === id)

      if(checklist){
        openShareChecklistModal(checklist)
      }
      return
    }

    if(action === 'delete-checklist'){
      if (!SupabaseService.getCurrentUser()) {
        alert('Please sign in to delete checklists')
        return
      }

      const id = btn.dataset.id
      const checklist = checklists.find(c => c.id === id)
      if (checklist && !canEditResource(checklist)) {
        alertOwnerOnly('checklists')
        return
      }
      showConfirm('Delete checklist?', 'This action cannot be undone.', async () => {
        try {
          await SupabaseService.deleteChecklist(id)
          checklists = checklists.filter(c => c.id !== id)

          // Clean up associated state
          delete currentChecklistStorageFilter[id]
          delete checklistCategorySortState[id]
          delete checklistCollapsedState[id]

          renderChecklist()
        } catch(err) {
          console.error('Error deleting checklist:', err)
          alert('Error deleting checklist: ' + err.message)
        }
      })
      return
    }

    if(action === 'add-items-to-checklist'){
      const id = btn.dataset.id
      const checklist = checklists.find(c => c.id === id)
      if (checklist && !canEditResource(checklist)) {
        alertOwnerOnly('checklists')
        return
      }
      showItemSelector(id, 'add')
      return
    }

    if(action === 'remove-items-from-checklist'){
      const id = btn.dataset.id
      const checklist = checklists.find(c => c.id === id)
      if (checklist && !canEditResource(checklist)) {
        alertOwnerOnly('checklists')
        return
      }
      showItemSelector(id, 'remove')
      return
    }

    if(action === 'clear-all-checks'){
      const id = btn.dataset.id
      const checklist = checklists.find(c => c.id === id)
      if(checklist){
        if (!canEditResource(checklist)) {
          alertOwnerOnly('checklists')
          return
        }
        checklist.items.forEach(it => it.checked = false)

        // Update checklist in Supabase
        if (SupabaseService.getCurrentUser()) {
          SupabaseService.updateChecklist(id, checklist).catch(err => {
            console.error('Error updating checklist:', err)
          })
        }

        renderChecklist()
      }
      return
    }

    if(action === 'copy-checklist'){
      if (!SupabaseService.getCurrentUser()) {
        alert('Please sign in to copy checklists')
        return
      }

      const id = btn.dataset.id
      const original = checklists.find(c => c.id === id)
      if(original){
        const copy = {
          ...original,
          id: uid(),
          name: original.name + ' (copy)',
          created: Date.now(),
          items: original.items.map(it => ({...it, checked: false}))
        }
        checklists.unshift(copy)

        // Save checklist to Supabase
        SupabaseService.createChecklist(copy).catch(err => {
          console.error('Error creating checklist copy:', err)
        })

        renderChecklist()
      }
      return
    }

    // Share checklist functionality temporarily disabled
    // if(action === 'share-checklist'){
    //   if (!SupabaseService.getCurrentUser()) {
    //     alert('Please sign in to share checklists')
    //     return
    //   }
    //
    //   const id = btn.dataset.id
    //   const checklist = checklists.find(c => c.id === id)
    //   if(checklist){
    //     openShareChecklistModal(checklist)
    //   }
    //   return
    // }
  })

  // Tags management
  let currentTags = []

  function renderTags() {
    if(!tagsDisplay) return

    tagsDisplay.innerHTML = currentTags.map(tag => `
      <div class="tag-item">
        <span>${escapeHtml(tag)}</span>
        <button type="button" class="tag-remove" data-tag="${escapeHtml(tag)}">×</button>
      </div>
    `).join('')

    // Add remove listeners
    tagsDisplay.querySelectorAll('.tag-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const tagToRemove = btn.dataset.tag
        currentTags = currentTags.filter(tag => tag !== tagToRemove)
        renderTags()
      })
    })
  }

  function addTag() {
    if(!newTagInput) return

    const newTag = newTagInput.value.trim()
    if(newTag && !currentTags.includes(newTag)) {
      currentTags.push(newTag)
      newTagInput.value = ''
      renderTags()
    }
  }

  if(addTagBtn) {
    addTagBtn.addEventListener('click', addTag)
  }

  if(newTagInput) {
    newTagInput.addEventListener('keypress', (e) => {
      if(e.key === 'Enter') {
        e.preventDefault()
        addTag()
      }
    })
  }

  // Update gear items when categories change
  function updateGearItems(){
    if(!categoriesCheckboxesEl || !gearItemsCheckboxesEl) return

    const selectedCategories = Array.from(categoriesCheckboxesEl.querySelectorAll('.category-checkbox:checked')).map(cb => cb.value)
    const selectedItemIds = Array.from(gearItemsCheckboxesEl.querySelectorAll('.gear-item-cb:checked')).map(cb => cb.value)
    renderGearItems(selectedCategories, selectedItemIds)
  }

  // Render category checkboxes in modal
  function renderCategoryCheckboxes(selectedCategories = []){
    if(!categoriesCheckboxesEl) return

    const allCategories = ['Shelter', 'Sleep System', 'Camp Furniture', 'Clothing', 'Footwear', 'Packs & Bags', 'Cooking', 'Electronics', 'Lighting', 'First Aid / Safety', 'Personal items / Documents', 'Knives & Tools', 'Technical Gear', 'Sports Equipment', 'Fishing & Hunting', 'Climbing & Rope', 'Winter & Snow', 'Photo/Video Gear', 'Ride Gear', 'Consumables']

    categoriesCheckboxesEl.innerHTML = allCategories.map(cat => {
      const checked = selectedCategories.includes(cat) ? 'checked' : ''
      const id = `cat-${cat.replace(/[^a-zA-Z0-9]/g, '-')}`
      return `
        <div class="checkbox-item">
          <input type="checkbox" id="${id}" value="${escapeHtml(cat)}" ${checked} class="category-checkbox">
          <label for="${id}">${escapeHtml(cat)}</label>
        </div>
      `
    }).join('')

    // Add change listeners to update gear items when categories change
    categoriesCheckboxesEl.querySelectorAll('.category-checkbox').forEach(cb => {
      cb.addEventListener('change', updateGearItems)
    })
  }

  // Render gear items based on selected categories
  function renderGearItems(selectedCategories = [], selectedItemIds = []){
    if(!gearItemsSectionEl || !gearItemsCheckboxesEl) return

    if(selectedCategories.length === 0){
      gearItemsSectionEl.style.display = 'none'
      return
    }

    gearItemsSectionEl.style.display = 'block'

    // Filter items by selected categories
    const rawFiltered = items.filter(item => selectedCategories.includes(item.category))
    // Apply checklist search filter (name / brand / model)
    const searchInput = document.getElementById('checklistItemSearch')
    const q = searchInput && searchInput.value ? searchInput.value.trim().toLowerCase() : ''
    const filteredItems = q ? rawFiltered.filter(item => {
      const name = (item.name || '').toLowerCase()
      const brand = (item.brand || '').toLowerCase()
      const model = (item.model || '').toLowerCase()
      return name.includes(q) || brand.includes(q) || model.includes(q)
    }) : rawFiltered

    if(filteredItems.length === 0){
      gearItemsCheckboxesEl.innerHTML = '<div style="padding:12px;text-align:center;color:var(--muted);font-size:13px;">No items in selected categories</div>'
      return
    }

    gearItemsCheckboxesEl.innerHTML = filteredItems.map(item => {
      const checked = selectedItemIds.includes(item.id) ? 'checked' : ''
      const brand = item.brand ? `${escapeHtml(item.brand)} ` : ''
      const model = item.model ? `${escapeHtml(item.model)}` : ''
      const weight = item.weight ? `${item.weight}g` : ''
      const thumbnail = item.image ? `<img src="${item.image}" alt="${escapeHtml(item.name)}" class="gear-item-thumbnail" loading="lazy">` : '<div class="gear-item-placeholder"></div>'

      return `
        <div class="gear-checkbox-item">
          <input type="checkbox" id="item-${item.id}" value="${item.id}" ${checked} class="gear-item-cb">
          <label for="item-${item.id}" class="gear-item-label">
            ${thumbnail}
            <div class="gear-item-details">
              <div class="gear-item-name">${escapeHtml(item.name)}</div>
              <div class="gear-item-meta">
                ${brand}${model ? brand ? '• ' + model : model : ''}
                ${weight ? `<span class="gear-item-weight">${weight}</span>` : ''}
              </div>
            </div>
          </label>
        </div>
      `
    }).join('')

    // Add change listeners for visual feedback
    gearItemsCheckboxesEl.querySelectorAll('.gear-item-cb').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const container = e.target.closest('.gear-item-checkbox')
        if(container) {
          if(e.target.checked){
            container.classList.add('selected')
          } else {
            container.classList.remove('selected')
          }
        }
      })
    })

    // Make entire item clickable
    gearItemsCheckboxesEl.querySelectorAll('.gear-item-checkbox').forEach(item => {
      item.addEventListener('click', (e) => {
        if(e.target.type !== 'checkbox'){
          const cb = item.querySelector('input[type="checkbox"]')
          cb.checked = !cb.checked
          cb.dispatchEvent(new Event('change'))
        }
      })
    })
  }

  // Wire search input to update the visible gear items as user types
  const checklistItemSearch = document.getElementById('checklistItemSearch')
  if (checklistItemSearch) {
    checklistItemSearch.addEventListener('input', () => {
      const selectedCategories = Array.from(document.querySelectorAll('#categoriesCheckboxes input[type="checkbox"]:checked')).map(cb => cb.value)
      const selectedItemIds = Array.from(gearItemsCheckboxesEl.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value)
      renderGearItems(selectedCategories, selectedItemIds)
    })
  }

  // Update gear items when category selection changes
  function updateGearItems(){
    const selectedCategories = Array.from(categoriesCheckboxesEl.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value)
    const selectedItemIds = Array.from(gearItemsCheckboxesEl.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value)
    renderGearItems(selectedCategories, selectedItemIds)
  }

  // Select all categories
  selectAllCategoriesBtn.addEventListener('click', () => {
    categoriesCheckboxesEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = true
    })
    updateGearItems()
  })

  // Deselect all categories
  deselectAllCategoriesBtn.addEventListener('click', () => {
    categoriesCheckboxesEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = false
    })
    updateGearItems()
  })

  // Select all items
  selectAllItemsBtn.addEventListener('click', () => {
    gearItemsCheckboxesEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = true
      const parent = cb.closest('.gear-item-checkbox')
      if (parent) parent.classList.add('selected')
    })
  })

  // Deselect all items
  deselectAllItemsBtn.addEventListener('click', () => {
    gearItemsCheckboxesEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = false
      const parent = cb.closest('.gear-item-checkbox')
      if (parent) parent.classList.remove('selected')
    })
  })

  // New checklist button
  newChecklistBtn.addEventListener('click', () => {
    editingChecklistId = null
    if(checklistModalTitle) checklistModalTitle.textContent = 'New Checklist'
    const subtitle = document.querySelector('.modal-subtitle')
    if(subtitle) subtitle.textContent = 'Create a new gear checklist for your trip'
    if(saveChecklistBtn) saveChecklistBtn.textContent = 'Create Checklist'
    if(checklistForm) checklistForm.reset()
    currentTags = []
    renderTags()
    renderCategoryCheckboxes()
    renderGearItems([], [])
    renderVisibilityPicker('checklistVisibilityPicker', { visibility: 'public' })
    if(checklistModal) checklistModal.classList.remove('hidden')
  })

  // Handle form submission from footer button
  document.getElementById('saveChecklistBtn').addEventListener('click', (e) => {
    e.preventDefault()
    checklistForm.dispatchEvent(new Event('submit'))
  })

  // Save checklist
  checklistForm.addEventListener('submit', e => {
    e.preventDefault()

    // Collect selected items from checkboxes
    const selectedItemIds = Array.from(gearItemsCheckboxesEl.querySelectorAll('.gear-item-cb:checked')).map(cb => cb.value)

    const data = {
      name: checklistNameInput.value.trim(),
      tags: [...currentTags],
      startDate: checklistStartDateInput?.value || null,
      endDate: checklistEndDateInput?.value || null,
      visibility: getVisibilityValue('checklistVisibilityPicker')
    }

    if(!data.name) return

    if(editingChecklistId){
      const idx = checklists.findIndex(c => c.id === editingChecklistId)
      if(idx !== -1){
        if (!canEditResource(checklists[idx])) {
          alertOwnerOnly('checklists')
          return
        }
        // Update basic data and items
        checklists[idx] = {
          ...checklists[idx],
          ...data,
          items: selectedItemIds.map(itemId => {
            // Keep existing checked state if item was already in checklist
            const existingItem = checklists[idx].items.find(item => item.itemId === itemId)
            return {itemId, checked: existingItem ? existingItem.checked : false}
          })
        }

        // Update checklist in Supabase
        if (SupabaseService.getCurrentUser()) {
          SupabaseService.updateChecklist(editingChecklistId, checklists[idx]).catch(err => {
            console.error('Error updating checklist:', err)
          })
        }
      }
    } else {
      if (!SupabaseService.getCurrentUser()) {
        alert('Please sign in to create checklists')
        return
      }

      const newChecklist = {
        ...data,
        id: uid(),
        created: Date.now(),
        items: selectedItemIds.map(itemId => ({itemId, checked: false}))
      }
      checklists.unshift(newChecklist)

      // Save checklist to Supabase
      SupabaseService.createChecklist(newChecklist).catch(err => {
        console.error('Error creating checklist:', err)
      })
    }

    renderChecklist()
    if(checklistModal) checklistModal.classList.add('hidden')
    checklistForm.reset()
  })

  // Close checklist modal
  if(closeChecklistModalBtn) {
    closeChecklistModalBtn.addEventListener('click', () => {
      if(checklistModal) checklistModal.classList.add('hidden')
      checklistForm.reset()
    })
  }

  if(cancelChecklistBtn) {
    cancelChecklistBtn.addEventListener('click', () => {
      if(checklistModal) checklistModal.classList.add('hidden')
      checklistForm.reset()
    })
  }

  // Select/Deselect all categories
  if(selectAllCategoriesBtn) {
    selectAllCategoriesBtn.addEventListener('click', () => {
      if(categoriesCheckboxesEl) {
        categoriesCheckboxesEl.querySelectorAll('.category-checkbox').forEach(cb => cb.checked = true)
        updateGearItems()
      }
    })
  }

  if(deselectAllCategoriesBtn) {
    deselectAllCategoriesBtn.addEventListener('click', () => {
      if(categoriesCheckboxesEl) {
        categoriesCheckboxesEl.querySelectorAll('.category-checkbox').forEach(cb => cb.checked = false)
        updateGearItems()
      }
    })
  }

  // Select/Deselect all gear items
  if(selectAllItemsBtn) {
    selectAllItemsBtn.addEventListener('click', () => {
      if(gearItemsCheckboxesEl) {
        gearItemsCheckboxesEl.querySelectorAll('.gear-item-cb').forEach(cb => cb.checked = true)
      }
    })
  }

  if(deselectAllItemsBtn) {
    deselectAllItemsBtn.addEventListener('click', () => {
      if(gearItemsCheckboxesEl) {
        gearItemsCheckboxesEl.querySelectorAll('.gear-item-cb').forEach(cb => cb.checked = false)
      }
    })
  }

  if(checklistModal) {
    checklistModal.addEventListener('click', e => {
      if(e.target === checklistModal){
        checklistModal.classList.add('hidden')
        checklistForm.reset()
      }
    })
  }

  // Item selector for adding/removing items to checklist
  function showItemSelector(checklistId, mode){
    const checklist = checklists.find(c => c.id === checklistId)
    if(!checklist) return
    if (!canEditResource(checklist)) {
      alertOwnerOnly('checklists')
      return
    }

    const existingIds = checklist.items.map(it => it.itemId)
    const modalTitle = mode === 'add' ? 'Add Items to Checklist' : 'Remove Items from Checklist'
    const itemsToShow = mode === 'add' ? items.filter(it => !existingIds.includes(it.id)) : items.filter(it => existingIds.includes(it.id))

    if(itemsToShow.length === 0){
      const msg = mode === 'add' ? 'All gear items are already in this checklist.' : 'No items to remove from this checklist.'
      showCustomAlert(msg)
      return
    }

    const content = `
      <div class="modal-content">
        <div class="modal-header">
          <h2>${modalTitle}</h2>
          <button id="closeSelectorModal" class="btn icon">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>
        <div style="padding:12px 20px;">
          <input id="itemSearchInput" type="search" class="field-input" placeholder="Search gear by name or brand..." style="width:100%;margin-bottom:12px;">
        </div>
        <div class="item-selector" id="itemSelector">
          ${itemsToShow.map(item => `
            <label class="selector-item">
              <input type="checkbox" value="${item.id}" class="gear-item-cb">
              ${item.image ? `<img class="selector-thumb" src="${item.image}" alt="${escapeHtml(item.name)}" loading="lazy">` : '<div class="selector-thumb-placeholder"></div>'}
              <div class="selector-item-info">
                <div class="selector-item-name">${escapeHtml(item.name)}</div>
                <div class="selector-item-brand">${escapeHtml(item.brand || '-')} • ${escapeHtml(item.category || 'No category')}</div>
              </div>
              <div class="selector-item-weight">${item.weight} g</div>
            </label>
          `).join('')}
        </div>
        <div class="form-actions">
          <button id="saveSelectorBtn" class="btn primary">Save</button>
          <button id="cancelSelectorBtn" class="btn secondary">Cancel</button>
        </div>
      </div>
    `

    const selectorModal = document.createElement('div')
    selectorModal.id = 'selectorModal'
    selectorModal.className = 'modal'
    selectorModal.innerHTML = content
    document.body.appendChild(selectorModal)

    setTimeout(() => selectorModal.classList.remove('hidden'), 10)
    // Setup search/filter inside selector modal
    const setupItemSearch = () => {
      const itemSearchInput = document.getElementById('itemSearchInput')
      if (!itemSearchInput) return
      itemSearchInput.addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase()
        document.querySelectorAll('#itemSelector .selector-item').forEach(label => {
          const nameEl = label.querySelector('.selector-item-name')
          const brandEl = label.querySelector('.selector-item-brand')
          const name = nameEl ? nameEl.textContent.toLowerCase() : ''
          const brand = brandEl ? brandEl.textContent.toLowerCase() : ''
          if (!q || name.includes(q) || brand.includes(q)) {
            label.style.display = ''
          } else {
            label.style.display = 'none'
          }
        })
      })
      // focus the search field for better UX
      setTimeout(() => itemSearchInput.focus(), 60)
    }
    setupItemSearch()

    // Handle selector interactions
    const closeSelectorModalBtn = document.getElementById('closeSelectorModal')
    const saveSelectorBtn = document.getElementById('saveSelectorBtn')
    const cancelSelectorBtn = document.getElementById('cancelSelectorBtn')

    const closeSelector = () => {
      selectorModal.classList.add('hidden')
      setTimeout(() => selectorModal.remove(), 200)
    }

    closeSelectorModalBtn.addEventListener('click', closeSelector)
    cancelSelectorBtn.addEventListener('click', closeSelector)
    selectorModal.addEventListener('click', e => {
      if(e.target === selectorModal) closeSelector()
    })

    saveSelectorBtn.addEventListener('click', () => {
      const selectedIds = Array.from(document.querySelectorAll('#itemSelector input:checked')).map(cb => cb.value)

      // Save category collapsed states before re-rendering
      const categoryStates = {}

      // Save category states within checklists
      document.querySelectorAll('.checklist-section').forEach(section => {
        const sectionId = section.dataset.checklistId

        // Save category states within this checklist
        const categoryElements = section.querySelectorAll('.category-section')
        categoryStates[sectionId] = {}
        categoryElements.forEach(catEl => {
          const category = catEl.dataset.category
          const itemsContainer = catEl.querySelector('.category-items')
          if (itemsContainer && category) {
            categoryStates[sectionId][category] = itemsContainer.classList.contains('collapsed')
          }
        })
      })

      if(mode === 'add'){
        selectedIds.forEach(itemId => {
          if(!checklist.items.find(it => it.itemId === itemId)){
            checklist.items.push({itemId, checked: false})
          }
        })
      } else {
        checklist.items = checklist.items.filter(it => !selectedIds.includes(it.itemId))
      }

      // Update checklist in Supabase
      if (SupabaseService.getCurrentUser()) {
        SupabaseService.updateChecklist(checklistId, checklist).catch(err => {
          console.error('Error updating checklist:', err)
        })
      }

      renderChecklist()

      // Restore category collapsed states after re-rendering (checklist states are now applied during render)
      setTimeout(() => {
        // Restore category states
        Object.keys(categoryStates).forEach(sectionId => {
          const section = document.querySelector(`.checklist-section[data-checklist-id="${sectionId}"]`)
          if (section && categoryStates[sectionId]) {
            Object.keys(categoryStates[sectionId]).forEach(category => {
              const catEl = section.querySelector(`.category-section[data-category="${category}"]`)
              if (catEl) {
                const itemsContainer = catEl.querySelector('.category-items')
                const chevron = catEl.querySelector('.cat-chevron')
                if (itemsContainer && categoryStates[sectionId][category]) {
                  itemsContainer.classList.add('collapsed')
                  if (chevron) {
                    chevron.style.transform = 'rotate(180deg)'
                  }
                } else if (itemsContainer && !categoryStates[sectionId][category]) {
                  itemsContainer.classList.remove('collapsed')
                  if (chevron) {
                    chevron.style.transform = 'rotate(0deg)'
                  }
                }
              }
            })
          }
        })
      }, 0)

      closeSelector()
    })
  }

  // ==================== AUTHENTICATION ====================

  const authModal = document.getElementById('authModal')
  const authForm = document.getElementById('authForm')
  const authEmail = document.getElementById('authEmail')
  const authPassword = document.getElementById('authPassword')
  const authPasswordToggle = document.getElementById('authPasswordToggle')
  const authRememberCredentials = document.getElementById('authRememberCredentials')
  const authNickname = document.getElementById('authNickname')
  const nicknameSection = document.getElementById('nicknameSection')
  const authSubmitBtn = document.getElementById('authSubmitBtn')
  const authToggleBtn = document.getElementById('authToggleBtn')
  const authToggleText = document.getElementById('authToggleText')
  const authTitle = document.getElementById('authTitle')
  const authError = document.getElementById('authError')
  const authContent = document.getElementById('authContent')
  const authLoading = document.getElementById('authLoading')
  const googleSignInBtn = document.getElementById('googleSignInBtn')
  const signInBtn = document.getElementById('signInBtn')
  const signOutBtn = document.getElementById('signOutBtn')
  const userStatus = document.getElementById('userStatus')
  const userEmail = document.getElementById('userEmail')
  const userAvatar = document.getElementById('userAvatar')
  const profileBtn = document.getElementById('profileBtn')

  // Profile modal elements
  const profileModal = document.getElementById('profileModal')
  const closeProfileModal = document.getElementById('closeProfileModal')
  const profileAvatar = document.getElementById('profileAvatar')
  const profileNickname = document.getElementById('profileNickname')
  const profileEmail = document.getElementById('profileEmail')
  const profilePassword = document.getElementById('profilePassword')
  const changeAvatarBtn = document.getElementById('changeAvatarBtn')
  const avatarInput = document.getElementById('avatarInput')
  const avatarMessage = document.getElementById('avatarMessage')
  const saveProfileBtn = document.getElementById('saveProfileBtn')
  const profileError = document.getElementById('profileError')
  const profileSuccess = document.getElementById('profileSuccess')

  let isSignUpMode = false
  let currentAvatarData = null
  const AUTH_CREDENTIALS_STORAGE_KEY = 'allmygear.authCredentials'

  function setAuthPasswordVisible(isVisible) {
    authPassword.type = isVisible ? 'text' : 'password'
    authPasswordToggle.classList.toggle('is-visible', isVisible)
    authPasswordToggle.setAttribute('aria-label', isVisible ? 'Hide password' : 'Show password')
    authPasswordToggle.setAttribute('aria-pressed', String(isVisible))
    authPasswordToggle.title = isVisible ? 'Hide password' : 'Show password'
  }

  function getSavedAuthCredentials() {
    try {
      const rawCredentials = localStorage.getItem(AUTH_CREDENTIALS_STORAGE_KEY)
      if (!rawCredentials) return null

      const credentials = JSON.parse(rawCredentials)
      if (!credentials || typeof credentials.email !== 'string' || typeof credentials.password !== 'string') {
        localStorage.removeItem(AUTH_CREDENTIALS_STORAGE_KEY)
        return null
      }

      return credentials
    } catch (err) {
      console.warn('Could not read saved auth credentials:', err)
      localStorage.removeItem(AUTH_CREDENTIALS_STORAGE_KEY)
      return null
    }
  }

  function applySavedAuthCredentials() {
    const credentials = getSavedAuthCredentials()
    if (!credentials) {
      authRememberCredentials.checked = false
      return
    }

    authEmail.value = credentials.email
    authPassword.value = credentials.password
    authRememberCredentials.checked = true
  }

  function persistAuthCredentials(email, password) {
    try {
      if (!authRememberCredentials.checked) {
        localStorage.removeItem(AUTH_CREDENTIALS_STORAGE_KEY)
        return
      }

      localStorage.setItem(AUTH_CREDENTIALS_STORAGE_KEY, JSON.stringify({ email, password }))
    } catch (err) {
      console.warn('Could not persist auth credentials:', err)
    }
  }

  // Check authentication state on load
  async function initAuth() {
    try {
      const user = await SupabaseService.getCurrentUser()
      if (user) {
        handleAuthSuccess(user)
      } else {
        // Hide loader if not authenticated
        hideLoader()
      }
      // Removed: automatic modal opening if not authenticated
    } catch (err) {
      console.error('Auth init error:', err)
      hideLoader()
      // Removed: automatic modal opening on error
    }
  }

  function showAuthModal() {
    // Reset to Sign In mode when opening
    isSignUpMode = false
    updateAuthToggle()
    applySavedAuthCredentials()
    setAuthPasswordVisible(false)
    authModal.classList.remove('hidden')
    authContent.style.display = 'block'
    authLoading.style.display = 'none'
    authError.style.display = 'none'
  }

  function hideAuthModal() {
    authModal.classList.add('hidden')
  }

  async function handleAuthSuccess(user) {
    isAuthenticated = true
    useSupabase = true
    checklistsLoaded = false
    hideAuthModal()

    // Show loader while loading data
    showLoader('Loading your gear...')

    // Hide sign in button and show user status
    signInBtn.style.display = 'none'
    userStatus.style.display = 'flex'

    // Show user status
    const displayName = user.user_metadata?.nickname || user.email
    userEmail.textContent = displayName

    // Load and display avatar
    if (user.user_metadata?.avatar_url) {
      const avatarUrl = await SupabaseService.getPhotoUrl(user.user_metadata.avatar_url)
      if (avatarUrl) {
        userAvatar.src = avatarUrl
        userAvatar.style.display = 'block'
      }
    }

    userStatus.style.display = 'flex'

    // Load data from Supabase
    await loadFromSupabase()

    // Setup realtime subscriptions
    // setupRealtimeSync()

    // Hide loader when done
    hideLoader()
  }

  function autoOrganizeCategories() {
    // Get categories that have items
    const categoriesWithItems = []
    const emptyCategoriesInOrder = []

    // Check each category in current order
    categoryOrder.forEach(cat => {
      const hasItems = items.some(item => item.category === cat)
      if (hasItems) {
        categoriesWithItems.push(cat)
      } else {
        emptyCategoriesInOrder.push(cat)
      }
    })

    // Check for any categories in items that aren't in categoryOrder
    const allItemCategories = [...new Set(items.map(item => item.category))]
    allItemCategories.forEach(cat => {
      if (!categoryOrder.includes(cat)) {
        categoriesWithItems.push(cat)
      }
    })

    // Rebuild category order: non-empty first (keeping their relative order), then empty
    categoryOrder = [...categoriesWithItems, ...emptyCategoriesInOrder]
  }

  async function loadFromSupabase() {
    if (isLoading) return // Prevent multiple simultaneous loads
    isLoading = true

    try {
      // Clear existing data first to prevent duplicates
      items = []
      checklists = []
      categoryOrder = []

      try {
        if (typeof SupabaseService.getCurrentUserEntitlements !== 'function') {
          visibilityEntitlements = { canUsePrivateVisibility: false }
          console.warn('Visibility entitlements API is unavailable; using free visibility defaults')
        } else {
        visibilityEntitlements = await SupabaseService.getCurrentUserEntitlements()
        }
      } catch (err) {
        console.warn('Error loading visibility entitlements:', err)
        visibilityEntitlements = { canUsePrivateVisibility: false }
      }

      // Load gear items
      const supabaseItems = await SupabaseService.getAllGearItems()

      // Try to get cached photo URLs first
      const cacheKey = 'allmygear.photoUrlsCache'
      const cacheTimeKey = 'allmygear.photoUrlsCacheTime'
      let photoUrls = {}
      let needsRefresh = false

      try {
        const cached = localStorage.getItem(cacheKey)
        const cacheTime = localStorage.getItem(cacheTimeKey)
        const now = Date.now()
        // Cache valid for 50 minutes (Supabase URLs expire in 1 hour)
        if (cached && cacheTime && (now - parseInt(cacheTime)) < 50 * 60 * 1000) {
          photoUrls = JSON.parse(cached)
          const cacheablePhotoUrls = photoUrlCache.getCacheablePhotoUrls(photoUrls, Object.keys(photoUrls))
          if (Object.keys(cacheablePhotoUrls).length !== Object.keys(photoUrls).length) {
            photoUrls = cacheablePhotoUrls
            needsRefresh = true
          }
        } else {
          needsRefresh = true
        }
      } catch (e) {
        needsRefresh = true
      }

      // Collect all image paths
      const imagePaths = supabaseItems
        .filter(item => item.image_path)
        .map(item => item.image_path)

      // Check if we need to fetch new URLs (cache miss or expired)
      if (needsRefresh || imagePaths.some(path => !photoUrls[path])) {
        // Batch fetch all photo URLs
        const freshUrls = imagePaths.length > 0
          ? await SupabaseService.getPhotoUrlsBatch(imagePaths)
          : {}

        // Only keep URLs for current items (remove old/unused entries)
        const currentPaths = new Set(imagePaths)
        photoUrls = Object.fromEntries(
          Object.entries({ ...photoUrls, ...freshUrls })
            .filter(([path]) => currentPaths.has(path))
        )

        // Save to cache with error handling
        try {
          const cacheablePhotoUrls = photoUrlCache.getCacheablePhotoUrls(photoUrls, imagePaths)
          localStorage.setItem(cacheKey, JSON.stringify(cacheablePhotoUrls))
          localStorage.setItem(cacheTimeKey, Date.now().toString())
        } catch (e) {
          if (e.name === 'QuotaExceededError') {
            // Clear all photo cache - too large for localStorage
            console.warn('localStorage quota exceeded - working without photo cache')
            localStorage.removeItem(cacheKey)
            localStorage.removeItem(cacheTimeKey)
            // Continue without caching - use freshUrls directly
            photoUrls = freshUrls
          } else {
            console.warn('Failed to cache photo URLs:', e)
          }
        }
      }

      // Map items with cached URLs (no await needed)
      items = supabaseItems.map((item) => ({
        id: item.id,
        category: item.category === 'Bag / Package' ? 'Packs & Bags' : item.category,
        name: item.name,
        brand: item.brand,
        model: item.model,
        weight: item.weight,
        price: item.price,
        year: item.year,
        rating: item.rating,
        comment: item.comment || '',
        image: item.image_path ? (photoUrls[item.image_path] || null) : null,
        image_path: item.image_path,
        storageId: item.storage_id !== undefined ? item.storage_id : null,
        visibility: item.visibility || 'public',
        publishedAt: item.published_at || item.publishedAt || null,
        accessSource: item.access_source || item.accessSource || 'mine',
        created: item.created_at
      }))

      // Load checklists lazily (only when needed)
      // Don't load checklists on initial page load to speed up startup
      checklists = []

      // Load category order
      const orderData = await SupabaseService.getCategoryOrder()
      const allPossibleCategories = ['Shelter', 'Sleep System', 'Camp Furniture', 'Clothing', 'Footwear', 'Packs & Bags', 'Cooking', 'Electronics', 'Lighting', 'First Aid / Safety', 'Personal items / Documents', 'Knives & Tools', 'Technical Gear', 'Sports Equipment', 'Fishing & Hunting', 'Climbing & Rope', 'Winter & Snow', 'Photo/Video Gear', 'Ride Gear', 'Consumables']

      if (orderData && orderData.categories) {
        // Merge saved order with new categories
        const savedCategories = orderData.categories.filter(cat => allPossibleCategories.includes(cat))
        const newCategories = allPossibleCategories.filter(cat => !savedCategories.includes(cat))
        categoryOrder = [...savedCategories, ...newCategories]
        categorySortMode = orderData.sort_modes || {}
      } else {
        loadCategoryOrder() // Use defaults
      }

      // Update category select dropdown to match loaded order
      updateCategorySelect()

      // Load storages
      try {
        storages = await SupabaseService.getAllStorages()
      } catch (err) {
        console.warn('Error loading storages:', err)
        storages = []
      }

      // Auto-organize categories: non-empty categories first, empty categories last
      autoOrganizeCategories()

      render()
      renderChecklist()
    } catch (err) {
      console.error('Error loading from Supabase:', err)
      alert('Error loading data: ' + err.message)
    } finally {
      isLoading = false
    }
  }

  // Lazy load checklists only when needed (on first tab switch)
  async function loadChecklistsIfNeeded() {
    if (checklistsLoaded || !isAuthenticated) return

    try {
      console.log('Loading checklists...')
      const supabaseChecklists = await SupabaseService.getAllChecklists()
      checklists = supabaseChecklists.map(cl => ({
        id: cl.id,
        name: cl.name,
        tags: cl.activities || [],
        startDate: cl.start_date || null,
        endDate: cl.end_date || null,
        visibility: cl.visibility || 'public',
        publishedAt: cl.published_at || cl.publishedAt || null,
        accessSource: cl.access_source || cl.accessSource || 'mine',
        items: (cl.items || []).map(item => ({
          ...item,
          category: item.category === 'Bag / Package' ? 'Packs & Bags' : item.category
        })),
        created: cl.created_at
      }))
      checklistsLoaded = true
      renderChecklist()
      console.log(`Loaded ${checklists.length} checklists`)
    } catch (err) {
      console.error('Error loading checklists:', err)
    }
  }

  // Debounce for realtime sync to prevent multiple rapid reloads
  let realtimeSyncTimeout = null
  const REALTIME_DEBOUNCE_MS = 500

  function setupRealtimeSync() {
    // Subscribe to gear items changes with incremental updates
    SupabaseService.subscribeToGearItems(async (payload) => {
      // Skip if we're currently loading
      if (isLoading) return

      const { eventType, new: newRecord, old: oldRecord } = payload

      try {
        if (eventType === 'INSERT' && newRecord) {
          // Add new item without full reload
          let image = null
          if (newRecord.image_path) {
            image = await SupabaseService.getPhotoUrl(newRecord.image_path)
          }
          const newItem = {
            id: newRecord.id,
            category: newRecord.category === 'Bag / Package' ? 'Packs & Bags' : newRecord.category,
            name: newRecord.name,
            brand: newRecord.brand,
            model: newRecord.model,
            weight: newRecord.weight,
            price: newRecord.price,
            year: newRecord.year,
            rating: newRecord.rating,
            image: image,
            image_path: newRecord.image_path,
            created: newRecord.created_at
          }
          // Only add if not already present
          if (!items.find(i => i.id === newItem.id)) {
            items.push(newItem)
            invalidateStatsCache()
            render()
          }
        } else if (eventType === 'UPDATE' && newRecord) {
          // Update existing item
          const index = items.findIndex(i => i.id === newRecord.id)
          if (index !== -1) {
            let image = items[index].image
            if (newRecord.image_path !== items[index].image_path) {
              image = newRecord.image_path ? await SupabaseService.getPhotoUrl(newRecord.image_path) : null
            }
            items[index] = {
              ...items[index],
              category: newRecord.category === 'Bag / Package' ? 'Packs & Bags' : newRecord.category,
              name: newRecord.name,
              brand: newRecord.brand,
              model: newRecord.model,
              weight: newRecord.weight,
              price: newRecord.price,
              year: newRecord.year,
              rating: newRecord.rating,
              image: image,
              image_path: newRecord.image_path
            }
            invalidateStatsCache()
            render()
          }
        } else if (eventType === 'DELETE' && oldRecord) {
          // Remove deleted item
          const index = items.findIndex(i => i.id === oldRecord.id)
          if (index !== -1) {
            items.splice(index, 1)
            invalidateStatsCache()
            render()
          }
        } else {
          // Fallback: debounced full reload for complex changes
          if (realtimeSyncTimeout) clearTimeout(realtimeSyncTimeout)
          realtimeSyncTimeout = setTimeout(() => loadFromSupabase(), REALTIME_DEBOUNCE_MS)
        }
      } catch (err) {
        console.error('Realtime sync error:', err)
        // Fallback to full reload on error
        if (realtimeSyncTimeout) clearTimeout(realtimeSyncTimeout)
        realtimeSyncTimeout = setTimeout(() => loadFromSupabase(), REALTIME_DEBOUNCE_MS)
      }
    })

    // Subscribe to checklists changes (debounced full reload - checklists are less frequent)
    SupabaseService.subscribeToChecklists((payload) => {
      if (realtimeSyncTimeout) clearTimeout(realtimeSyncTimeout)
      realtimeSyncTimeout = setTimeout(() => loadFromSupabase(), REALTIME_DEBOUNCE_MS)
    })
  }

  // OAuth Sign In handlers
  const appleSignInBtn = document.getElementById('appleSignInBtn')
  const githubSignInBtn = document.getElementById('githubSignInBtn')
  const discordSignInBtn = document.getElementById('discordSignInBtn')

  googleSignInBtn.addEventListener('click', async () => {
    try {
      authError.style.display = 'none'
      await SupabaseService.signInWithGoogle()
    } catch (err) {
      console.error('Google sign in error:', err)
      authError.textContent = err.message
      authError.style.display = 'block'
    }
  })

  appleSignInBtn.addEventListener('click', async () => {
    try {
      authError.style.display = 'none'
      await SupabaseService.signInWithApple()
    } catch (err) {
      console.error('Apple sign in error:', err)
      authError.textContent = err.message
      authError.style.display = 'block'
    }
  })

  githubSignInBtn.addEventListener('click', async () => {
    try {
      authError.style.display = 'none'
      await SupabaseService.signInWithGitHub()
    } catch (err) {
      console.error('GitHub sign in error:', err)
      authError.textContent = err.message
      authError.style.display = 'block'
    }
  })

  discordSignInBtn.addEventListener('click', async () => {
    try {
      authError.style.display = 'none'
      await SupabaseService.signInWithDiscord()
    } catch (err) {
      console.error('Discord sign in error:', err)
      authError.textContent = err.message
      authError.style.display = 'block'
    }
  })

  const facebookSignInBtn = document.getElementById('facebookSignInBtn')
  const twitterSignInBtn = document.getElementById('twitterSignInBtn')

  facebookSignInBtn.addEventListener('click', async () => {
    try {
      authError.style.display = 'none'
      await SupabaseService.signInWithFacebook()
    } catch (err) {
      console.error('Facebook sign in error:', err)
      authError.textContent = err.message
      authError.style.display = 'block'
    }
  })

  twitterSignInBtn.addEventListener('click', async () => {
    try {
      authError.style.display = 'none'
      await SupabaseService.signInWithTwitter()
    } catch (err) {
      console.error('Twitter sign in error:', err)
      authError.textContent = err.message
      authError.style.display = 'block'
    }
  })

  authPasswordToggle.addEventListener('click', () => {
    setAuthPasswordVisible(authPassword.type === 'password')
    authPassword.focus()
  })

  authRememberCredentials.addEventListener('change', () => {
    if (!authRememberCredentials.checked) {
      try {
        localStorage.removeItem(AUTH_CREDENTIALS_STORAGE_KEY)
      } catch (err) {
        console.warn('Could not clear saved auth credentials:', err)
      }
    }
  })

  // Email/Password Form
  authForm.addEventListener('submit', async (e) => {
    e.preventDefault()

    const email = authEmail.value.trim()
    const password = authPassword.value
    const nickname = authNickname.value.trim()

    try {
      authError.style.display = 'none'

      // Validation
      if (isSignUpMode && !nickname) {
        authError.textContent = 'Please enter a nickname'
        authError.style.display = 'block'
        return
      }

      if (password.length < 6) {
        authError.textContent = 'Password must be at least 6 characters'
        authError.style.display = 'block'
        return
      }

      authContent.style.display = 'none'
      authLoading.style.display = 'block'

      if (isSignUpMode) {
        const result = await SupabaseService.signUpWithEmail(email, password, nickname)
        persistAuthCredentials(email, password)
        authLoading.style.display = 'none'
        authContent.style.display = 'block'

        if (result.user && !result.session) {
          alert('✅ Account created!\n\nCheck your email (' + email + ') and click the confirmation link to activate your account.\n\nThen come back here and sign in.')
        } else {
          alert('✅ Account created! You can now sign in.')
        }

        isSignUpMode = false
        updateAuthToggle()
        authForm.reset()
        applySavedAuthCredentials()
      } else {
        const result = await SupabaseService.signInWithEmail(email, password)
        persistAuthCredentials(email, password)

        // Check if email is confirmed
        if (result.user && !result.user.email_confirmed_at) {
          authLoading.style.display = 'none'
          authContent.style.display = 'block'
          authError.textContent = '⚠️ Please confirm your email first. Check your inbox for the confirmation link.'
          authError.style.display = 'block'
          return
        }

        await handleAuthSuccess(result.user)
      }
    } catch (err) {
      console.error('Auth error:', err)
      authLoading.style.display = 'none'
      authContent.style.display = 'block'

      // Better error messages
      let errorMsg = err.message
      if (err.message.includes('Invalid login credentials')) {
        errorMsg = '❌ Invalid email or password. Please check and try again.'
      } else if (err.message.includes('Email not confirmed')) {
        errorMsg = '⚠️ Please confirm your email first. Check your inbox.'
      } else if (err.message.includes('User already registered')) {
        errorMsg = '⚠️ This email is already registered. Try signing in instead.'
      }

      authError.textContent = errorMsg
      authError.style.display = 'block'
    }
  })

  // Toggle between Sign In / Sign Up
  authToggleBtn.addEventListener('click', () => {
    isSignUpMode = !isSignUpMode
    setAuthPasswordVisible(false)
    updateAuthToggle()
  })

  function updateAuthToggle() {
    const oauthSignInSection = document.getElementById('oauthSignInSection')
    const authSubtitle = document.getElementById('authSubtitle')
    if (isSignUpMode) {
      authTitle.textContent = 'Sign Up'
      authSubtitle.textContent = 'Create your account to get started'
      authSubmitBtn.textContent = 'Create Account'
      authToggleText.textContent = 'Already have an account?'
      authToggleBtn.textContent = 'Sign In'
      nicknameSection.style.display = 'block'
      authNickname.required = true
      // Hide OAuth buttons for registration
      if (oauthSignInSection) oauthSignInSection.style.display = 'none'
    } else {
      authTitle.textContent = 'Sign In'
      authSubtitle.textContent = 'Access your gear lists from anywhere'
      authSubmitBtn.textContent = 'Sign In'
      authToggleText.textContent = "Don't have an account?"
      authToggleBtn.textContent = 'Sign Up'
      nicknameSection.style.display = 'none'
      authNickname.required = false
      // Hide OAuth buttons (not configured yet)
      if (oauthSignInSection) oauthSignInSection.style.display = 'none'
    }
  }

  // Sign Out
  // Sign in button
  signInBtn.addEventListener('click', () => {
    showAuthModal()
  })

  // Close auth modal button
  const closeAuthModalBtn = document.getElementById('closeAuthModal')
  if (closeAuthModalBtn) {
    closeAuthModalBtn.addEventListener('click', () => {
      hideAuthModal()
    })
  }

  // Close auth modal when clicking outside
  authModal.addEventListener('click', (e) => {
    if (e.target === authModal) {
      hideAuthModal()
    }
  })

  signOutBtn.addEventListener('click', async () => {
    try {
      await SupabaseService.signOut()
      isAuthenticated = false
      useSupabase = false
      checklistsLoaded = false
      // Show sign in button and hide user status
      signInBtn.style.display = 'block'
      userStatus.style.display = 'none'
      userAvatar.style.display = 'none'
      items = []
      checklists = []
      categoryOrder = []
      render()
      renderChecklist()
    } catch (err) {
      console.error('Sign out error:', err)
      alert('Error signing out: ' + err.message)
    }
  })

  // ==================== PROFILE MANAGEMENT ====================

  // Open profile modal
  profileBtn.addEventListener('click', async () => {
    try {
      const user = await SupabaseService.getCurrentUser()
      if (!user) return

      // Populate form
      profileNickname.value = user.user_metadata?.nickname || ''
      profileEmail.value = user.email
      profilePassword.value = ''

      // Load avatar
      if (user.user_metadata?.avatar_url) {
        const avatarUrl = await SupabaseService.getPhotoUrl(user.user_metadata.avatar_url)
        profileAvatar.src = avatarUrl || ''
      } else {
        profileAvatar.src = ''
      }

      profileError.style.display = 'none'
      profileSuccess.style.display = 'none'
      profileModal.classList.remove('hidden')
    } catch (err) {
      console.error('Error opening profile:', err)
    }
  })

  // Close profile modal
  closeProfileModal.addEventListener('click', () => {
    profileModal.classList.add('hidden')
    currentAvatarData = null
  })

  profileModal.addEventListener('click', (e) => {
    if (e.target === profileModal) {
      profileModal.classList.add('hidden')
      currentAvatarData = null
    }
  })

  // Change avatar
  changeAvatarBtn.addEventListener('click', () => {
    avatarInput.click()
  })

  avatarInput.addEventListener('change', async () => {
    const file = avatarInput.files && avatarInput.files[0]
    avatarMessage.textContent = ''

    if (!file) return

    try {
      // Read and compress image to 200KB
      avatarMessage.textContent = 'Processing...'

      let dataUrl
      if (file.size <= MAX_IMAGE_SIZE) {
        dataUrl = await readFileAsDataURL(file)
        avatarMessage.textContent = `Image ${Math.round(file.size/1024)} KB — uploaded`
        avatarMessage.style.color = '#4a8166'
      } else {
        avatarMessage.textContent = `Image ${Math.round(file.size/1024)} KB — compressing...`
        avatarMessage.style.color = '#fbbf24'
        dataUrl = await processImageFile(file, MAX_IMAGE_SIZE)
        const approxSize = Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 3/4)
        if(approxSize <= MAX_IMAGE_SIZE){
          avatarMessage.textContent = `Image compressed to ≈ ${Math.round(approxSize/1024)} KB`
          avatarMessage.style.color = '#4a8166'
        } else {
          avatarMessage.textContent = `Failed to compress to ${Math.round(MAX_IMAGE_SIZE/1024)} KB — result ≈ ${Math.round(approxSize/1024)} KB`
            avatarMessage.style.color = 'var(--brand-orange)'
        }
      }

      // Show preview
      profileAvatar.src = dataUrl
      currentAvatarData = dataUrl
    } catch (err) {
      console.error('Error processing avatar:', err)
      avatarMessage.textContent = 'Error processing image'
      avatarMessage.style.color = 'var(--brand-orange)'
    }
  })  // Save profile

  saveProfileBtn.addEventListener('click', async () => {
    try {
      profileError.style.display = 'none'
      profileSuccess.style.display = 'none'

      const nickname = profileNickname.value.trim()
      const newPassword = profilePassword.value

      if (!nickname) {
        profileError.textContent = 'Nickname is required'
        profileError.style.display = 'block'
        return
      }

      if (newPassword && newPassword.length < 6) {
        profileError.textContent = 'Password must be at least 6 characters'
        profileError.style.display = 'block'
        return
      }

      saveProfileBtn.disabled = true
      saveProfileBtn.textContent = 'Saving...'

      // Get current user
      const user = await SupabaseService.getCurrentUser()

      // Upload avatar if changed
      let avatarPath = user.user_metadata?.avatar_url || null
      if (currentAvatarData) {
        avatarPath = await SupabaseService.uploadPhoto('avatar_' + user.id, currentAvatarData)
      }

      // Update profile
      await SupabaseService.updateProfile(nickname, newPassword, avatarPath)

      // Reload user data
      const updatedUser = await SupabaseService.getCurrentUser()

      const displayName = updatedUser.user_metadata?.nickname || updatedUser.email
      userEmail.textContent = displayName

      // Update avatar in header
      if (avatarPath) {
        const avatarUrl = await SupabaseService.getPhotoUrl(avatarPath)
        if (avatarUrl) {
          userAvatar.src = avatarUrl
          userAvatar.style.display = 'block'
        }
      }

      profileSuccess.textContent = '✓ Profile updated successfully!'
      profileSuccess.style.display = 'block'
      saveProfileBtn.textContent = 'Save Changes'
      saveProfileBtn.disabled = false
      currentAvatarData = null

      setTimeout(() => {
        profileModal.classList.add('hidden')
      }, 1500)

    } catch (err) {
      console.error('Error updating profile:', err)
      profileError.textContent = err.message
      profileError.style.display = 'block'
      saveProfileBtn.textContent = 'Save Changes'
      saveProfileBtn.disabled = false
    }
  })

  // Cancel button in profile modal (if present)
  const cancelProfileBtn = document.getElementById('cancelProfileBtn')
  if (cancelProfileBtn) {
    cancelProfileBtn.addEventListener('click', () => {
      profileModal.classList.add('hidden')
      currentAvatarData = null
    })
  }

  // ==================== SHARING FUNCTIONALITY ====================

  const shareModal = document.getElementById('shareModal')
  const closeShareModal = document.getElementById('closeShareModal')
  const shareLoading = document.getElementById('shareLoading')
  const shareContent = document.getElementById('shareContent')
  const shareLinkInput = document.getElementById('shareLinkInput')
  const copyShareLink = document.getElementById('copyShareLink')
  const shareCopySuccess = document.getElementById('shareCopySuccess')

  const viewSharedModal = document.getElementById('viewSharedModal')
  const closeViewSharedModal = document.getElementById('closeViewSharedModal')
  const sharedItemContent = document.getElementById('sharedItemContent')
  const saveSharedItem = document.getElementById('saveSharedItem')
  const closeSharedView = document.getElementById('closeSharedView')

  let currentShareCode = null

  // Handle share button click
  cardsEl.addEventListener('click', async e => {
    const shareBtn = e.target.closest('[data-action="share"]')
    if (!shareBtn) return

    e.stopPropagation()
    const itemId = shareBtn.dataset.id

    if (!isAuthenticated) {
      alert('Please sign in to share items')
      return
    }

    // Find item data in memory
    const item = items.find(i => i.id === itemId)
    if (!item) {
      alert('Item not found')
      return
    }

    // Show modal with loading
    shareModal.classList.remove('hidden')
    shareLoading.style.display = 'flex'
    shareContent.style.display = 'none'
    shareCopySuccess.style.display = 'none'

    try {
      const { shareUrl } = await SupabaseService.createShareLink(itemId, item)
      shareLinkInput.value = shareUrl
      shareLoading.style.display = 'none'
      shareContent.style.display = 'block'
    } catch (err) {
      console.error('Error creating share link:', err)
      shareLoading.innerHTML = `<span style="color:#fb7185;">Error: ${err.message}</span>`
    }
  })

  // Close share modal
  closeShareModal?.addEventListener('click', () => {
    shareModal.classList.add('hidden')
  })

  shareModal?.addEventListener('click', e => {
    if (e.target === shareModal) {
      shareModal.classList.add('hidden')
    }
  })

  // Copy share link
  copyShareLink?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareLinkInput.value)
      shareCopySuccess.style.display = 'block'
      copyShareLink.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
        </svg>
        Copied!
      `
      setTimeout(() => {
        copyShareLink.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
          </svg>
          Copy
        `
        shareCopySuccess.style.display = 'none'
      }, 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  })

  // Share to messengers
  const shareWhatsAppBtn = document.getElementById('shareWhatsApp')
  const shareTelegramBtn = document.getElementById('shareTelegram')
  const shareFacebookBtn = document.getElementById('shareFacebook')
  const shareEmailBtn = document.getElementById('shareEmail')

  shareWhatsAppBtn?.addEventListener('click', () => {
    const url = shareLinkInput?.value
    if (!url) return
    const text = `Check out this gear item: ${url}`
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  })

  shareTelegramBtn?.addEventListener('click', () => {
    const url = shareLinkInput?.value
    if (!url) return
    const text = 'Check out this gear item'
    window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`, '_blank')
  })

  shareFacebookBtn?.addEventListener('click', () => {
    const url = shareLinkInput?.value
    if (!url) return
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank')
  })

  shareEmailBtn?.addEventListener('click', () => {
    const url = shareLinkInput?.value
    if (!url) return
    const subject = 'Check out this gear item'
    const body = `I wanted to share this gear item with you:\n\n${url}`
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  })

  // Check for share code in URL on page load
  async function checkForSharedItem() {
    const params = new URLSearchParams(window.location.search)
    const shareCode = params.get('share')

    if (!shareCode) return

    currentShareCode = shareCode

    try {
      const sharedItem = await SupabaseService.getSharedItem(shareCode)

      // Render shared item preview
      sharedItemContent.innerHTML = `
        <div class="shared-item-card">
          ${sharedItem.image 
            ? `<img src="${sharedItem.image}" alt="${escapeHtml(sharedItem.name)}" class="shared-item-image">` 
            : '<div class="shared-item-no-image">No photo</div>'}
          <div class="shared-item-info">
            <div class="shared-item-category">${escapeHtml(sharedItem.category || 'Uncategorized')}</div>
            <div class="shared-item-name">${escapeHtml(sharedItem.name)}</div>
            ${sharedItem.brand ? `<div class="shared-item-brand">${escapeHtml(sharedItem.brand)} ${sharedItem.model ? escapeHtml(sharedItem.model) : ''}</div>` : ''}
            <div class="shared-item-stats">
              ${sharedItem.weight ? `
                <div class="shared-item-stat">
                  <span class="shared-item-stat-label">Weight</span>
                  <span class="shared-item-stat-value">${formatWeight(sharedItem.weight)}</span>
                </div>
              ` : ''}
              ${sharedItem.price ? `
                <div class="shared-item-stat">
                  <span class="shared-item-stat-label">Price</span>
                  <span class="shared-item-stat-value">${formatPrice(sharedItem.price)}</span>
                </div>
              ` : ''}
              ${sharedItem.year ? `
                <div class="shared-item-stat">
                  <span class="shared-item-stat-label">Year</span>
                  <span class="shared-item-stat-value">${sharedItem.year}</span>
                </div>
              ` : ''}
              ${sharedItem.rating ? `
                <div class="shared-item-stat">
                  <span class="shared-item-stat-label">Rating</span>
                  <span class="shared-item-stat-value shared-item-rating">${'★'.repeat(sharedItem.rating)}${'☆'.repeat(5-sharedItem.rating)}</span>
                </div>
              ` : ''}
            </div>
          </div>
        </div>
      `

      // Show/hide save button based on auth status
      if (isAuthenticated) {
        saveSharedItem.style.display = 'flex'
        saveSharedItem.disabled = false
        saveSharedItem.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
          </svg>
          Save to My Gear
        `
      } else {
        saveSharedItem.style.display = 'flex'
        saveSharedItem.innerHTML = 'Sign in to save'
        saveSharedItem.disabled = true
      }

      viewSharedModal.classList.remove('hidden')

      // Clean URL without reload
      window.history.replaceState({}, '', window.location.pathname)

    } catch (err) {
      console.error('Error loading shared item:', err)
      alert('Could not load shared item: ' + err.message)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }

  // Close view shared modal
  closeViewSharedModal?.addEventListener('click', () => {
    viewSharedModal.classList.add('hidden')
    currentShareCode = null
  })

  closeSharedView?.addEventListener('click', () => {
    viewSharedModal.classList.add('hidden')
    currentShareCode = null
  })

  viewSharedModal?.addEventListener('click', e => {
    if (e.target === viewSharedModal) {
      viewSharedModal.classList.add('hidden')
      currentShareCode = null
    }
  })

  // Save shared item
  saveSharedItem?.addEventListener('click', async () => {
    if (!currentShareCode || !isAuthenticated) return

    saveSharedItem.disabled = true
    saveSharedItem.innerHTML = `
      <div class="spinner" style="width:16px;height:16px;border-width:2px;"></div>
      Saving...
    `

    try {
      const newItem = await SupabaseService.saveSharedItem(currentShareCode)

      // Add to local items
      items.unshift({
        id: newItem.id,
        category: newItem.category,
        name: newItem.name,
        brand: newItem.brand,
        model: newItem.model,
        weight: newItem.weight,
        price: newItem.price,
        year: newItem.year,
        rating: newItem.rating,
        image: newItem.image,
        created: newItem.created
      })

      invalidateStatsCache()
      render()

      saveSharedItem.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
        </svg>
        Saved!
      `

      setTimeout(() => {
        viewSharedModal.classList.add('hidden')
        currentShareCode = null
      }, 1000)

    } catch (err) {
      console.error('Error saving shared item:', err)
      saveSharedItem.innerHTML = `Error: ${err.message}`
      saveSharedItem.disabled = false
    }
  })

  // Check for shared item on load
  checkForSharedItem()

  // Check for shared checklist in URL
  async function checkForSharedChecklist() {
    const params = new URLSearchParams(window.location.search)
    const shareCode = params.get('checklist')

    if (!shareCode) return

    try {
      const sharedChecklist = await SupabaseService.getSharedChecklist(shareCode)
      const viewSharedChecklistModal = document.getElementById('viewSharedChecklistModal')
      const closeViewSharedChecklistModal = document.getElementById('closeViewSharedChecklistModal')
      const closeSharedChecklistView = document.getElementById('closeSharedChecklistView')
      const sharedChecklistContent = document.getElementById('sharedChecklistContent')

      if (!viewSharedChecklistModal || !sharedChecklistContent) {
        console.error('Shared checklist modal elements not found')
        return
      }

      // Calculate total weight
      const totalWeight = (sharedChecklist.items || []).reduce((sum, item) => sum + (Number(item.weight) || 0), 0)
      const totalPrice = (sharedChecklist.items || []).reduce((sum, item) => sum + (Number(item.price) || 0), 0)

      // Render shared checklist preview
      sharedChecklistContent.innerHTML = `
        <div class="shared-checklist-header">
          <h3>${escapeHtml(sharedChecklist.name)}</h3>
          ${sharedChecklist.tags && sharedChecklist.tags.length > 0 ? `
            <div class="shared-checklist-tags">
              ${sharedChecklist.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
            </div>
          ` : ''}
          ${sharedChecklist.start_date || sharedChecklist.end_date ? `
            <div class="shared-checklist-dates">
              ${sharedChecklist.start_date ? new Date(sharedChecklist.start_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}
              ${sharedChecklist.start_date && sharedChecklist.end_date ? ' — ' : ''}
              ${sharedChecklist.end_date ? new Date(sharedChecklist.end_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}
            </div>
          ` : ''}
          <div class="shared-checklist-stats">
            <span><strong>${(sharedChecklist.items || []).length}</strong> items</span>
            <span><strong>${formatWeight(totalWeight)}</strong> total</span>
            ${totalPrice > 0 ? `<span><strong>${formatPrice(totalPrice)}</strong> value</span>` : ''}
          </div>
        </div>
        <div class="shared-checklist-items">
          ${(sharedChecklist.items || []).map(item => `
            <div class="shared-checklist-item">
              <div class="shared-checklist-item-name">${escapeHtml(item.name || 'Unnamed item')}</div>
              <div class="shared-checklist-item-details">
                ${item.brand ? `<span>${escapeHtml(item.brand)}</span>` : ''}
                ${item.category ? `<span class="shared-checklist-item-category">${escapeHtml(item.category)}</span>` : ''}
                ${item.weight ? `<span class="shared-checklist-item-weight">${formatWeight(item.weight)}</span>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      `

      viewSharedChecklistModal.classList.remove('hidden')

      // Close handlers
      const closeModal = () => {
        viewSharedChecklistModal.classList.add('hidden')
        window.history.replaceState({}, '', window.location.pathname)
      }

      closeViewSharedChecklistModal?.addEventListener('click', closeModal)
      closeSharedChecklistView?.addEventListener('click', closeModal)

      // Clean URL without reload
      window.history.replaceState({}, '', window.location.pathname)

    } catch (err) {
      console.error('Error loading shared checklist:', err)
      alert('Could not load shared checklist: ' + err.message)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }

  // Check for shared checklist on load
  checkForSharedChecklist()

  // =============================================
  // SHARE CHECKLIST FUNCTIONALITY
  // =============================================

  const shareChecklistModal = document.getElementById('shareChecklistModal')
  const closeShareChecklistModal = document.getElementById('closeShareChecklistModal')
  const shareChecklistLoading = document.getElementById('shareChecklistLoading')
  const shareChecklistContent = document.getElementById('shareChecklistContent')
  const shareChecklistLinkInput = document.getElementById('shareChecklistLinkInput')
  const copyShareChecklistLink = document.getElementById('copyShareChecklistLink')
  const shareChecklistCopySuccess = document.getElementById('shareChecklistCopySuccess')

  // Open share checklist modal function
  async function openShareChecklistModal(checklist) {
    if (!isAuthenticated) {
      alert('Please sign in to share checklists')
      return
    }

    // Show modal with loading
    shareChecklistModal.classList.remove('hidden')
    shareChecklistLoading.style.display = 'flex'
    shareChecklistContent.style.display = 'none'
    shareChecklistCopySuccess.style.display = 'none'

    try {
      console.log('Checklist to share:', checklist)
      console.log('Available items:', items.length)

      // Get full item data for each item in checklist
      const fullItems = checklist.items.map(checklistItem => {
        const item = items.find(i => i.id === checklistItem.itemId)
        console.log(`Looking for item ${checklistItem.itemId}:`, item)
        if (!item) return null
        return {
          id: item.id,
          name: item.name,
          brand: item.brand,
          model: item.model,
          category: item.category,
          weight: item.weight,
          price: item.price,
          year: item.year,
          image_path: item.image_path,
          checked: checklistItem.checked
        }
      }).filter(item => item !== null)

      console.log('Full items for sharing:', fullItems)

      // Create checklist data with full items
      const checklistWithFullItems = {
        ...checklist,
        items: fullItems
      }

      console.log('Calling createChecklistShare...')
      const { shareUrl } = await SupabaseService.createChecklistShare(checklist.id, checklistWithFullItems)
      console.log('Share URL created:', shareUrl)
      shareChecklistLinkInput.value = shareUrl
      shareChecklistLoading.style.display = 'none'
      shareChecklistContent.style.display = 'block'
    } catch (err) {
      console.error('Error creating checklist share link:', err)
      shareChecklistLoading.innerHTML = `<span style="color:#fb7185;">Error: ${err.message}</span>`
    }
  }

  // Close share checklist modal
  closeShareChecklistModal?.addEventListener('click', () => {
    shareChecklistModal.classList.add('hidden')
  })

  shareChecklistModal?.addEventListener('click', e => {
    if (e.target === shareChecklistModal) {
      shareChecklistModal.classList.add('hidden')
    }
  })

  // Copy checklist share link
  copyShareChecklistLink?.addEventListener('click', async () => {
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareChecklistLinkInput.value)
      } else {
        // Fallback for older browsers or file:// protocol
        shareChecklistLinkInput.select()
        shareChecklistLinkInput.setSelectionRange(0, 99999) // For mobile
        document.execCommand('copy')
      }

      shareChecklistCopySuccess.style.display = 'block'
      copyShareChecklistLink.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
        </svg>
        Copied!
      `
      setTimeout(() => {
        copyShareChecklistLink.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
          </svg>
          Copy
        `
        shareChecklistCopySuccess.style.display = 'none'
      }, 2000)
    } catch (err) {
      console.error('Failed to copy checklist link:', err)
      // Show error to user
      copyShareChecklistLink.innerHTML = `Copy failed`
      setTimeout(() => {
        copyShareChecklistLink.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
          </svg>
          Copy
        `
      }, 2000)
    }
  })

  // Share checklist to messengers
  const shareChecklistWhatsAppBtn = document.getElementById('shareChecklistWhatsApp')
  const shareChecklistTelegramBtn = document.getElementById('shareChecklistTelegram')
  const shareChecklistFacebookBtn = document.getElementById('shareChecklistFacebook')
  const shareChecklistEmailBtn = document.getElementById('shareChecklistEmail')

  shareChecklistWhatsAppBtn?.addEventListener('click', () => {
    const url = shareChecklistLinkInput?.value
    if (!url) return
    const text = `Check out this checklist: ${url}`
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  })

  shareChecklistTelegramBtn?.addEventListener('click', () => {
    const url = shareChecklistLinkInput?.value
    if (!url) return
    const text = 'Check out this checklist'
    window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`, '_blank')
  })

  shareChecklistFacebookBtn?.addEventListener('click', () => {
    const url = shareChecklistLinkInput?.value
    if (!url) return
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank')
  })

  shareChecklistEmailBtn?.addEventListener('click', () => {
    const url = shareChecklistLinkInput?.value
    if (!url) return
    const subject = 'Check out this checklist'
    const body = `I wanted to share this checklist with you:\n\n${url}`
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  })

  // Sign out from profile modal (separate button)
  const profileSignOutBtn = document.getElementById('profileSignOutBtn')
  if (profileSignOutBtn) {
    profileSignOutBtn.addEventListener('click', async () => {
      try {
        await SupabaseService.signOut()
        isAuthenticated = false
        useSupabase = false
        signInBtn.style.display = 'block'
        userStatus.style.display = 'none'
        userAvatar.style.display = 'none'
        items = []
        checklists = []
        categoryOrder = []
        render()
        renderChecklist()
      } catch (err) {
        console.error('Sign out error (profile):', err)
        alert('Error signing out: ' + err.message)
      }
    })
  }

  // Override save/load functions to use Supabase when authenticated
  const originalSave = window.save
  const originalLoad = window.load

  // Handle image loading errors - refresh expired URLs
  async function handleImageError(img) {
    const itemId = img.closest('[data-id]')?.dataset.id
    if (!itemId) return

    const item = items.find(it => it.id === itemId)
    if (!item || !item.image_path) return

    try {
      // Get fresh URL for this image
      const freshUrl = await SupabaseService.getPhotoUrl(item.image_path)
      if (freshUrl) {
        // Update item
        item.image = freshUrl

        // Update cache
        const cacheKey = 'allmygear.photoUrlsCache'
        try {
          const cached = localStorage.getItem(cacheKey)
          const photoUrls = cached ? JSON.parse(cached) : {}
          photoUrls[item.image_path] = freshUrl
          const cacheablePhotoUrls = photoUrlCache.getCacheablePhotoUrls(photoUrls, [item.image_path])
          localStorage.setItem(cacheKey, JSON.stringify(cacheablePhotoUrls))
          localStorage.setItem('allmygear.photoUrlsCacheTime', Date.now().toString())
        } catch (e) {
          console.warn('Failed to update photo cache:', e)
        }

        // Update image src
        img.src = freshUrl
      }
    } catch (err) {
      console.error('Failed to refresh image URL:', err)
    }
  }

  // Add error handlers to all images
  document.addEventListener('error', (e) => {
    if (e.target.tagName === 'IMG' && e.target.classList.contains('thumb')) {
      setTimeout(() => {
        console.log("handleImageError")
        handleImageError(e.target)
      }, 1000);
    }
  }, true)
})()
