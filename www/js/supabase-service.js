// Supabase Service Layer
// Handles authentication, database operations, and storage

const MAX_INIT_ATTEMPTS = 50 // 5 seconds max wait

// Initialize Supabase client (wait for SDK to load)
let supabaseClient = null
let initAttempts = 0

function initSupabase() {
  console.log('initSupabase')

  if (window.supabase && window.supabase.createClient) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    console.log('Supabase client initialized')
    return true
  }
  return false
}

// Try to initialize with retries
function tryInitSupabase() {
  console.log('tryInitSupabase')

  if (initSupabase()) {
    return
  }

  initAttempts++
  if (initAttempts < MAX_INIT_ATTEMPTS) {
    setTimeout(tryInitSupabase, 100) // Try every 100ms
  } else {
    console.error('Supabase SDK failed to load after 5 seconds')
  }
}

// Helper to ensure supabase is initialized
function getSupabase() {
  if (!supabaseClient) {
    throw new Error('Supabase client not initialized. Please refresh the page.')
  }
  return supabaseClient
}

function isMissingEntitlementsSchemaError(error) {
  return (error && error.code === 'PGRST205') || /public\.user_entitlements/i.test(error?.message || '')
}

function isMissingVisibleSearchRpcError(error, rpcName) {
  const message = error?.message || ''
  return (error && error.code === 'PGRST202') || message.includes(rpcName)
}

// Start initialization attempts
tryInitSupabase()

const SupabaseService = {
  currentUser: null,

  mapGearItem(row) {
    return window.VisibilityUI.mapGearRowToModel(row, this.currentUser?.id)
  },

  mapChecklist(row) {
    return window.VisibilityUI.mapChecklistRowToModel(row, this.currentUser?.id)
  },

  mapStorage(row) {
    return window.VisibilityUI.mapStorageRowToModel(row, this.currentUser?.id)
  },

  // ==================== AUTHENTICATION ====================

  async signInWithGoogle() {
    const { data, error } = await getSupabase().auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + window.location.pathname
      }
    })
    if (error) throw error
    return data
  },

  async signInWithApple() {
    const { data, error } = await getSupabase().auth.signInWithOAuth({
      provider: 'apple',
      options: {
        redirectTo: window.location.origin + window.location.pathname
      }
    })
    if (error) throw error
    return data
  },

  async signInWithGitHub() {
    const { data, error } = await getSupabase().auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: window.location.origin + window.location.pathname
      }
    })
    if (error) throw error
    return data
  },

  async signInWithDiscord() {
    const { data, error } = await getSupabase().auth.signInWithOAuth({
      provider: 'discord',
      options: {
        redirectTo: window.location.origin + window.location.pathname
      }
    })
    if (error) throw error
    return data
  },

  async signInWithFacebook() {
    const { data, error } = await getSupabase().auth.signInWithOAuth({
      provider: 'facebook',
      options: {
        redirectTo: window.location.origin + window.location.pathname
      }
    })
    if (error) throw error
    return data
  },

  async signInWithTwitter() {
    const { data, error } = await getSupabase().auth.signInWithOAuth({
      provider: 'twitter',
      options: {
        redirectTo: window.location.origin + window.location.pathname
      }
    })
    if (error) throw error
    return data
  },

  async signInWithEmail(email, password) {
    const { data, error } = await getSupabase().auth.signInWithPassword({
      email,
      password
    })
    if (error) throw error
    this.currentUser = data.user
    return data
  },

  async signUpWithEmail(email, password, nickname) {
    const { data, error } = await getSupabase().auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin + window.location.pathname,
        data: {
          nickname: nickname
        }
      }
    })
    if (error) throw error
    return data
  },

  async signOut() {
    const { error } = await getSupabase().auth.signOut()
    if (error) throw error
    this.currentUser = null
  },

  async getCurrentUser() {
    const { data: { user } } = await getSupabase().auth.getUser()
    this.currentUser = user
    return user
  },

  onAuthStateChange(callback) {
    return getSupabase().auth.onAuthStateChanged((event, session) => {
      this.currentUser = session?.user || null
      callback(event, session)
    })
  },

  async updateProfile(nickname, newPassword, avatarPath) {
    if (!this.currentUser) throw new Error('Not authenticated')

    const updates = {}

    // Always update nickname in metadata
    if (nickname) {
      updates.data = { nickname }

      // Add avatar to metadata if provided
      if (avatarPath) {
        updates.data.avatar_url = avatarPath
      }
    }

    // Update password separately if provided
    if (newPassword) {
      const { error: pwdError } = await getSupabase().auth.updateUser({
        password: newPassword
      })
      if (pwdError) {
        console.error('Password update error:', pwdError)
        throw pwdError
      }
    }

    // Update user metadata (nickname and avatar)
    if (updates.data) {
      const { data, error } = await getSupabase().auth.updateUser(updates)
      if (error) {
        console.error('Metadata update error:', error)
        throw error
      }
      this.currentUser = data.user
      return data
    }

    return { user: this.currentUser }
  },

  // ==================== GEAR ITEMS ====================

  async getAllGearItems() {
    if (!this.currentUser) throw new Error('Not authenticated')

    const { data, error } = await supabaseClient
      .from('gear_items')
      .select('*')
      .eq('user_id', this.currentUser.id)
      .order('category', { ascending: true })
      .order('order_index', { ascending: true, nullsLast: true })
      .order('created_at', { ascending: false })

    if (error) throw error
    return (data || []).map(row => this.mapGearItem(row))
  },

  // Cache for max order index to avoid extra queries
  _maxOrderCache: null,
  _maxOrderCacheTime: 0,

  async createGearItem(item) {
    if (!this.currentUser) throw new Error('Not authenticated')

    // Use cached max order if available and fresh (within 5 seconds)
    const now = Date.now()
    let newOrderIndex

    if (this._maxOrderCache !== null && (now - this._maxOrderCacheTime) < 5000) {
      // Use cached value and increment
      this._maxOrderCache++
      newOrderIndex = this._maxOrderCache
    } else {
      // Get the maximum order_index for this user
      const { data: maxOrderData } = await supabaseClient
        .from('gear_items')
        .select('order_index')
        .eq('user_id', this.currentUser.id)
        .order('order_index', { ascending: false })
        .limit(1)

      const maxOrder = maxOrderData?.[0]?.order_index ?? -1
      newOrderIndex = maxOrder + 1
      this._maxOrderCache = newOrderIndex
      this._maxOrderCacheTime = now
    }

    const { data, error } = await supabaseClient
      .from('gear_items')
      .insert([{
        id: item.id,
        user_id: this.currentUser.id,
        category: item.category,
        name: item.name,
        brand: item.brand,
        model: item.model,
        weight: item.weight,
        price: item.price,
        year: item.year,
        rating: item.rating,
        comment: item.comment || '',
        image_path: item.image || null,
        storage_id: item.storageId || null,
        ...window.VisibilityUI.buildResourceSavePayload(item),
        order_index: newOrderIndex,
        created_at: item.created ? new Date(item.created).toISOString() : new Date().toISOString()
      }])
      .select()
      .maybeSingle()

    if (error) throw error
    return data ? this.mapGearItem(data) : data
  },

  async updateGearItem(id, updates) {
    if (!this.currentUser) throw new Error('Not authenticated')

    let imageToSave = updates.image

    // Handle image upload if base64 data is provided
    if (updates.image && updates.image.startsWith('data:')) {
      // For now, save base64 directly (can be changed to upload to storage later)
      imageToSave = updates.image
    }

    const visibilityUpdates = updates.visibility !== undefined
      ? window.VisibilityUI.buildResourceSavePayload(updates)
      : {}

    // Filter and map fields to match database schema
    const dbUpdates = {
      category: updates.category,
      name: updates.name,
      brand: updates.brand,
      model: updates.model,
      weight: updates.weight,
      price: updates.price,
      year: updates.year,
      rating: updates.rating,
      comment: updates.comment,
      image_path: imageToSave, // Map image to image_path
      storage_id: updates.storageId !== undefined ? (updates.storageId || null) : undefined,
      ...visibilityUpdates,
      order_index: updates.order_index,
      updated_at: new Date().toISOString()
    }

    // Remove undefined fields
    Object.keys(dbUpdates).forEach(key => {
      if (dbUpdates[key] === undefined) {
        delete dbUpdates[key]
      }
    })

    const { data, error } = await supabaseClient
      .from('gear_items')
      .update(dbUpdates)
      .eq('id', id)
      .eq('user_id', this.currentUser.id)
      .select()
      .maybeSingle()

    if (error) throw error
    return data ? this.mapGearItem(data) : data
  },

  async deleteGearItem(id) {
    if (!this.currentUser) throw new Error('Not authenticated')

    const { error } = await supabaseClient
      .from('gear_items')
      .delete()
      .eq('id', id)
      .eq('user_id', this.currentUser.id)

    if (error) throw error
  },

  // ==================== GEAR CATALOG (Community Suggestions) ====================

  async searchGearCatalog(query, brand = null, limit = 10) {
    const { data, error } = await supabaseClient
      .rpc('search_gear_catalog', {
        search_query: query || '',
        search_brand: brand || '',
        result_limit: limit
      })

    if (error) {
      console.error('Gear catalog search error:', error)
      return []
    }
    return data || []
  },

  async getGearSuggestionsByBrand(brand, limit = 20) {
    if (!brand) return []

    const { data, error } = await supabaseClient
      .from('gear_catalog')
      .select('*')
      .ilike('brand', `%${brand}%`)
      .order('usage_count', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('Gear suggestions error:', error)
      return []
    }
    return data || []
  },

  async getModelSuggestions(brand, modelQuery = '', limit = 10) {
    if (!brand) return []

    let query = supabaseClient
      .from('gear_catalog')
      .select('model, name, avg_weight, avg_price, avg_rating, usage_count')
      .ilike('brand', brand)
      .order('usage_count', { ascending: false })
      .limit(limit)

    if (modelQuery) {
      query = query.ilike('model', `%${modelQuery}%`)
    }

    const { data, error } = await query

    if (error) {
      console.error('Model suggestions error:', error)
      return []
    }
    return data || []
  },

  // ==================== CHECKLISTS ====================

  async getAllChecklists() {
    if (!this.currentUser) throw new Error('Not authenticated')

    const { data, error } = await supabaseClient
      .from('checklists')
      .select('*')
      .eq('user_id', this.currentUser.id)
      .order('created_at', { ascending: false })

    if (error) throw error
    return data || []
  },

  async createChecklist(checklist) {
    if (!this.currentUser) throw new Error('Not authenticated')

    const { data, error } = await supabaseClient
      .from('checklists')
      .insert([{
        id: checklist.id,
        user_id: this.currentUser.id,
        name: checklist.name,
        activities: checklist.tags || [], // Use activities column for tags
        items: checklist.items || [],
        start_date: checklist.startDate || null,
        end_date: checklist.endDate || null,
        ...window.VisibilityUI.buildResourceSavePayload(checklist),
        created_at: checklist.created ? new Date(checklist.created).toISOString() : new Date().toISOString()
      }])
      .select()
      .maybeSingle()

    if (error) throw error
    return data ? this.mapChecklist(data) : data
  },

  async updateChecklist(id, updates) {
    if (!this.currentUser) throw new Error('Not authenticated')

    const visibilityUpdates = updates.visibility !== undefined
      ? window.VisibilityUI.buildResourceSavePayload(updates)
      : {}

    // Map frontend fields to database fields and filter out read-only fields
    // Support both camelCase (from form) and snake_case (from database)
    const updateData = {
      name: updates.name,
      activities: updates.tags, // Use activities column for tags
      items: updates.items,
      start_date: updates.startDate || updates.start_date || null,
      end_date: updates.endDate || updates.end_date || null,
      ...visibilityUpdates,
      updated_at: new Date().toISOString()
    }

    const { data, error } = await supabaseClient
      .from('checklists')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', this.currentUser.id)
      .select()
      .maybeSingle()

    if (error) throw error
    return data ? this.mapChecklist(data) : data
  },

  async deleteChecklist(id) {
    if (!this.currentUser) throw new Error('Not authenticated')

    const { error } = await supabaseClient
      .from('checklists')
      .delete()
      .eq('id', id)
      .eq('user_id', this.currentUser.id)

    if (error) throw error
  },

  // ==================== CATEGORY ORDER ====================

  async getCategories() {
    const { data, error } = await supabaseClient
      .from('categories')
      .select('id, name, display_order')
      .eq('is_active', true)
      .order('display_order', { ascending: true })

    if (error) throw error

    return data || []
  },

  async getOutdoorBrands() {
    const { data, error } = await supabaseClient
      .from('outdoor_brands')
      .select('id, name, display_name')
      .eq('is_active', true)
      .order('display_name', { ascending: true })

    if (error) throw error

    return (data || [])
      .map(brand => brand.display_name || brand.name)
      .filter(Boolean)
  },

  async getOutdoorActivities() {
    const { data, error } = await supabaseClient
      .from('outdoor_activities')
      .select('id, name, display_name')
      .eq('is_active', true)
      .order('display_name', { ascending: true })

    if (error) throw error

    return (data || [])
      .map(activity => activity.display_name || activity.name)
      .filter(Boolean)
  },

  async getCategoryOrder() {
    if (!this.currentUser) throw new Error('Not authenticated')

    const categories = await this.getCategories()
    const { data, error } = await supabaseClient
      .from('user_category_preferences')
      .select('order_index, sort_mode, category:categories(id, name)')
      .eq('user_id', this.currentUser.id)
      .order('order_index', { ascending: true })

    if (error) {
      throw error
    }

    const orderedPreferenceNames = []
    const sortModes = {}

    ;(data || []).forEach(pref => {
      const categoryName = pref.category?.name
      if (!categoryName || orderedPreferenceNames.includes(categoryName)) return

      orderedPreferenceNames.push(categoryName)
      sortModes[categoryName] = pref.sort_mode || 'name'
    })

    const missingCategories = categories
      .map(category => category.name)
      .filter(name => !orderedPreferenceNames.includes(name))

    return {
      categories: orderedPreferenceNames.concat(missingCategories),
      sort_modes: sortModes
    }
  },

  async _saveLegacyCategoryOrder(categoryData, sortModes = {}) {
    if (!this.currentUser) throw new Error('Not authenticated')

    // First, delete existing category order for this user
    await supabaseClient
      .from('category_order')
      .delete()
      .eq('user_id', this.currentUser.id)

    // Then insert the new data
    const { data, error } = await supabaseClient
      .from('category_order')
      .insert({
        user_id: this.currentUser.id,
        categories: categoryData,
        sort_modes: sortModes,
        updated_at: new Date().toISOString()
      })
      .select()
      .maybeSingle()

    if (error) throw error
    return data
  },

  async saveCategoryOrder(categoryData, sortModes = {}) {
    if (!this.currentUser) throw new Error('Not authenticated')

    const categories = await this.getCategories()
    const categoryIdsByName = new Map(categories.map(category => [category.name, category.id]))
    const missingCategoryNames = categoryData.filter(categoryName => !categoryIdsByName.has(categoryName))

    if (missingCategoryNames.length > 0) {
      throw new Error(`Unknown categories: ${missingCategoryNames.join(', ')}`)
    }

    const rows = categoryData
      .map((categoryName, index) => ({
        user_id: this.currentUser.id,
        category_id: categoryIdsByName.get(categoryName),
        order_index: index,
        sort_mode: sortModes[categoryName] || 'name',
        updated_at: new Date().toISOString()
      }))
      .filter(row => row.category_id)

    const { error: deleteError } = await supabaseClient
      .from('user_category_preferences')
      .delete()
      .eq('user_id', this.currentUser.id)

    if (deleteError) {
      throw deleteError
    }

    if (rows.length > 0) {
      const { error: insertError } = await supabaseClient
        .from('user_category_preferences')
        .insert(rows)

      if (insertError) {
        throw insertError
      }
    }

    await this._saveLegacyCategoryOrder(categoryData, sortModes)

    return {
      categories: categoryData,
      sort_modes: sortModes
    }
  },

  async saveItemsOrder(itemsOrder) {
    if (!this.currentUser) throw new Error('Not authenticated')

    // Group items by category and assign order_index within each category
    const categorizedItems = {}
    itemsOrder.forEach(item => {
      const category = item.category || 'uncategorized'
      if (!categorizedItems[category]) {
        categorizedItems[category] = []
      }
      categorizedItems[category].push(item)
    })

    // Update order_index for items within each category
    for (const category of Object.keys(categorizedItems)) {
      const categoryItems = categorizedItems[category]
      for (let i = 0; i < categoryItems.length; i++) {
        await supabaseClient
          .from('gear_items')
          .update({ order_index: i })
          .eq('id', categoryItems[i].id)
          .eq('user_id', this.currentUser.id)
      }
    }

    return true
  },

  // Backwards-compatible wrapper: some parts of the app call `saveItems`
  // Provide a simple alias that calls `saveItemsOrder` so older call sites continue to work.
  async saveItems(items) {
    return this.saveItemsOrder(items)
  },

  // ==================== ENTITLEMENTS / ACCESS GRANTS ====================

  async getCurrentUserEntitlements() {
    if (!this.currentUser) return { canUsePrivateVisibility: false }

    const { data, error } = await supabaseClient
      .from('user_entitlements')
      .select('*')
      .eq('user_id', this.currentUser.id)
      .maybeSingle()

    if (error) {
      if (isMissingEntitlementsSchemaError(error)) {
        console.info('Entitlements schema is not available; using free visibility defaults')
        return { canUsePrivateVisibility: false }
      }
      console.warn('Entitlements lookup failed, falling back to free plan:', error)
      return { canUsePrivateVisibility: false }
    }

    return {
      ...(data || {}),
      canUsePrivateVisibility: Boolean(data?.can_make_private || data?.can_share_with_users || data?.can_use_private_visibility || data?.private_visibility_enabled)
    }
  },

  async canUsePrivateVisibility() {
    const entitlements = await this.getCurrentUserEntitlements()
    return window.VisibilityUI.hasPrivateVisibility(entitlements)
  },

  async getResourceAccessGrants(resourceType, resourceId) {
    if (!this.currentUser) throw new Error('Not authenticated')

    const { data, error } = await supabaseClient
      .from('resource_access_grants')
      .select('*')
      .eq('resource_type', this.normalizeResourceType(resourceType))
      .eq('resource_id', resourceId)
      .eq('owner_id', this.currentUser.id)
      .order('created_at', { ascending: true })

    if (error) throw error
    return data || []
  },

  async setResourceVisibility(resourceType, resourceId, visibility) {
    if (!this.currentUser) throw new Error('Not authenticated')

    const table = this.getResourceTable(resourceType)
    const payload = window.VisibilityUI.buildResourceSavePayload({ visibility })

    const { data, error } = await supabaseClient
      .from(table)
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', resourceId)
      .eq('user_id', this.currentUser.id)
      .select()
      .maybeSingle()

    if (error) throw error
    return this.mapResourceRow(resourceType, data)
  },

  async grantResourceAccess(resourceType, resourceId, emailOrUserId) {
    if (!this.currentUser) throw new Error('Not authenticated')

    const trimmed = (emailOrUserId || '').trim()
    if (!trimmed) throw new Error('Email or user id is required')

    const grant = {
      resource_type: this.normalizeResourceType(resourceType),
      resource_id: resourceId,
      owner_id: this.currentUser.id
    }

    if (trimmed.includes('@')) {
      grant.grantee_email = trimmed.toLowerCase()
    } else {
      grant.grantee_user_id = trimmed
    }

    const { data, error } = await supabaseClient
      .from('resource_access_grants')
      .insert(grant)
      .select()
      .single()

    if (error) throw error
    return data
  },

  async revokeResourceAccess(grantId) {
    if (!this.currentUser) throw new Error('Not authenticated')

    const { error } = await supabaseClient
      .from('resource_access_grants')
      .delete()
      .eq('id', grantId)
      .eq('owner_id', this.currentUser.id)

    if (error) throw error
  },

  getResourceTable(resourceType) {
    const tables = {
      gear: 'gear_items',
      gear_item: 'gear_items',
      item: 'gear_items',
      checklist: 'checklists',
      storage: 'storages'
    }

    const table = tables[resourceType]
    if (!table) throw new Error(`Unsupported resource type: ${resourceType}`)
    return table
  },

  normalizeResourceType(resourceType) {
    const types = {
      gear: 'gear_item',
      gear_item: 'gear_item',
      item: 'gear_item',
      checklist: 'checklist',
      storage: 'storage'
    }

    const normalized = types[resourceType]
    if (!normalized) throw new Error(`Unsupported resource type: ${resourceType}`)
    return normalized
  },

  mapResourceRow(resourceType, row) {
    if (!row) return row
    if (['gear', 'gear_item', 'item'].includes(resourceType)) return this.mapGearItem(row)
    if (resourceType === 'checklist') return this.mapChecklist(row)
    if (resourceType === 'storage') return this.mapStorage(row)
    return row
  },

  // ==================== GLOBAL SEARCH ====================

  handleVisibleSearchError(error, rpcName) {
    if (isMissingVisibleSearchRpcError(error, rpcName)) {
      console.info(`${rpcName} is not available; returning empty visible search results`)
      return []
    }
    throw error
  },

  async searchVisibleGear(query = '', filters = {}) {
    if (!this.currentUser) throw new Error('Not authenticated')

    const { data, error } = await supabaseClient.rpc('search_visible_gear', {
      search_query: query || '',
      result_limit: filters.limit || 50,
      result_offset: filters.offset || 0
    })

    if (error) return this.handleVisibleSearchError(error, 'search_visible_gear')
    return this.filterVisibleResults((data || []).map(row => this.mapGearItem(row)), filters)
  },

  async searchVisibleChecklists(query = '', filters = {}) {
    if (!this.currentUser) throw new Error('Not authenticated')

    const { data, error } = await supabaseClient.rpc('search_visible_checklists', {
      search_query: query || '',
      result_limit: filters.limit || 50,
      result_offset: filters.offset || 0
    })

    if (error) return this.handleVisibleSearchError(error, 'search_visible_checklists')
    return this.filterVisibleResults((data || []).map(row => this.mapChecklist(row)), filters)
  },

  async searchVisibleStorages(query = '', filters = {}) {
    if (!this.currentUser) throw new Error('Not authenticated')

    const { data, error } = await supabaseClient.rpc('search_visible_storages', {
      search_query: query || '',
      result_limit: filters.limit || 50,
      result_offset: filters.offset || 0
    })

    if (error) return this.handleVisibleSearchError(error, 'search_visible_storages')
    return this.filterVisibleResults((data || []).map(row => this.mapStorage(row)), filters)
  },

  filterVisibleResults(rows, filters = {}) {
    const scope = filters.visibility || filters.scope || 'all'
    if (scope === 'all' || scope === 'all_visible') return rows
    if (scope === 'mine') return rows.filter(row => row.accessSource === 'mine' || row.access_source === 'mine')
    if (scope === 'public') return rows.filter(row => row.visibility === 'public' || row.accessSource === 'public' || row.access_source === 'public')
    if (scope === 'shared') return rows.filter(row => row.accessSource === 'shared' || row.access_source === 'shared' || row.accessSource === 'shared_with_me' || row.access_source === 'shared_with_me')
    return rows
  },

  // ==================== STORAGE ====================

  async uploadPhoto(itemId, photoDataUrl) {
    if (!this.currentUser) throw new Error('Not authenticated')

    // Convert base64 to blob
    const response = await fetch(photoDataUrl)
    const blob = await response.blob()

    // Generate path: users/{userId}/{itemId}.jpg
    const filePath = `${this.currentUser.id}/${itemId}.jpg`

    const { data, error } = await getSupabase().storage
      .from('gear-photos')
      .upload(filePath, blob, {
        contentType: 'image/jpeg',
        upsert: true
      })

    if (error) throw error
    return filePath
  },

  // Cache for signed URLs (valid for 1 hour, cache for 50 minutes)
  _urlCache: new Map(),
  _urlCacheExpiry: 50 * 60 * 1000, // 50 minutes in ms

  async getPhotoUrl(imagePath) {
    if (!imagePath) return null;

    // Base64 image: return as is
    if (typeof imagePath === 'string' && imagePath.startsWith('data:')) {
      return imagePath;
    }

    // Full URL: return as is
    if (typeof imagePath === 'string' && imagePath.startsWith('http')) {
      return imagePath;
    }

    // Check cache first
    const cached = this._urlCache.get(imagePath)
    if (cached && Date.now() < cached.expiry) {
      return cached.url
    }

    // Try to get signed URL for storage file
    try {
      const { data, error } = await getSupabase().storage
        .from('gear-photos')
        .createSignedUrl(imagePath, 3600);
      if (error) {
        console.error('Error getting photo URL:', error, 'imagePath:', imagePath);
        return null;
      }

      // Cache the URL
      this._urlCache.set(imagePath, {
        url: data.signedUrl,
        expiry: Date.now() + this._urlCacheExpiry
      })

      return data.signedUrl;
    } catch (err) {
      console.error('Exception in getPhotoUrl:', err, 'imagePath:', imagePath);
      return null;
    }
  },

  // Batch get photo URLs for multiple items
  async getPhotoUrlsBatch(imagePaths) {
    const results = {}
    const pathsToFetch = []

    // Check cache first
    for (const path of imagePaths) {
      if (!path) continue

      if (path.startsWith('data:') || path.startsWith('http')) {
        results[path] = path
        continue
      }

      const cached = this._urlCache.get(path)
      if (cached && Date.now() < cached.expiry) {
        results[path] = cached.url
      } else {
        pathsToFetch.push(path)
      }
    }

    // Fetch remaining URLs in parallel (limited concurrency)
    if (pathsToFetch.length > 0) {
      const BATCH_SIZE = 10
      for (let i = 0; i < pathsToFetch.length; i += BATCH_SIZE) {
        const batch = pathsToFetch.slice(i, i + BATCH_SIZE)
        const batchResults = await Promise.all(
          batch.map(async (path) => {
            try {
              const { data, error } = await getSupabase().storage
                .from('gear-photos')
                .createSignedUrl(path, 3600)
              if (error) return { path, url: null }

              this._urlCache.set(path, {
                url: data.signedUrl,
                expiry: Date.now() + this._urlCacheExpiry
              })

              return { path, url: data.signedUrl }
            } catch {
              return { path, url: null }
            }
          })
        )

        for (const { path, url } of batchResults) {
          results[path] = url
        }
      }
    }

    return results
  },

  async deletePhoto(imagePath) {
    if (!this.currentUser || !imagePath) return

    const { error } = await getSupabase().storage
      .from('gear-photos')
      .remove([imagePath])

    if (error) throw error
  },

  // ==================== MIGRATION ====================

  async migrateFromLocalStorage(localData = null) {
    if (!this.currentUser) throw new Error('Not authenticated')

    // If no localData provided, read from localStorage
    if (!localData) {
      const itemsData = localStorage.getItem('allmygear.items')
      const checklistsData = localStorage.getItem('allmygear.checklists')
      const categoryOrderData = localStorage.getItem('allmygear.categoryOrder')

      localData = {
        items: itemsData ? JSON.parse(itemsData) : [],
        checklists: checklistsData ? JSON.parse(checklistsData) : [],
        categoryOrder: categoryOrderData ? JSON.parse(categoryOrderData) : []
      }
    }

    const results = {
      items: 0,
      checklists: 0,
      photos: 0,
      errors: []
    }

    try {
      // Migrate gear items
      if (localData.items && localData.items.length > 0) {
        for (const item of localData.items) {
          try {
            // Generate new UUID for Supabase
            const newId = crypto.randomUUID()

            // Upload photo if exists
            let imagePath = null
            if (item.image) {
              imagePath = await this.uploadPhoto(newId, item.image)
              results.photos++
            }

            // Create item in database with new UUID
            await this.createGearItem({
              ...item,
              id: newId, // Use new UUID instead of localStorage ID
              image_path: imagePath,
              image: undefined // Don't store base64 in DB
            })
            results.items++
          } catch (err) {
            console.error('Error migrating item:', item.name, err)
            results.errors.push(`Item ${item.name}: ${err.message}`)
          }
        }
      }

      // Migrate checklists
      if (localData.checklists && localData.checklists.length > 0) {
        for (const checklist of localData.checklists) {
          try {
            // Generate new UUID for checklist
            const newId = crypto.randomUUID()

            await this.createChecklist({
              ...checklist,
              id: newId // Use new UUID instead of localStorage ID
            })
            results.checklists++
          } catch (err) {
            console.error('Error migrating checklist:', checklist.name, err)
            results.errors.push(`Checklist ${checklist.name}: ${err.message}`)
          }
        }
      }

      // Migrate category order
      if (localData.categoryOrder) {
        try {
          await this.saveCategoryOrder(localData.categoryOrder)
        } catch (err) {
          // Silently continue migration
        }
      }

      // Clear localStorage after successful migration
      localStorage.removeItem('allmygear.items')
      localStorage.removeItem('allmygear.checklists')
      localStorage.removeItem('allmygear.categoryOrder')

      return results

    } catch (err) {
      console.error('Migration failed:', err)
      throw err
    }
  },

  // ==================== REALTIME SYNC ====================

  subscribeToGearItems(callback) {
    if (!this.currentUser) return null

    return supabaseClient
      .channel('gear_items_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'gear_items',
          filter: `user_id=eq.${this.currentUser.id}`
        },
        callback
      )
      .subscribe()
  },

  subscribeToChecklists(callback) {
    if (!this.currentUser) return null

    return supabaseClient
      .channel('checklists_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'checklists',
          filter: `user_id=eq.${this.currentUser.id}`
        },
        callback
      )
      .subscribe()
  },

  // ==================== CLEANUP ====================

  async removeDuplicateGearItems() {
    if (!this.currentUser) throw new Error('Not authenticated')

    // Get all items for current user
    const { data: items, error } = await supabaseClient
      .from('gear_items')
      .select('*')
      .eq('user_id', this.currentUser.id)
      .order('created_at', { ascending: true }) // Keep oldest

    if (error) throw error

    // Group by name + brand + model to find duplicates
    const seen = new Map()
    const duplicatesToDelete = []

    items.forEach(item => {
      const key = `${item.name}-${item.brand}-${item.model}`
      if (seen.has(key)) {
        // This is a duplicate, mark for deletion
        duplicatesToDelete.push(item.id)
      } else {
        // First occurrence, keep it
        seen.set(key, item.id)
      }
    })

    // Delete duplicates
    if (duplicatesToDelete.length > 0) {
      const { error: deleteError } = await supabaseClient
        .from('gear_items')
        .delete()
        .in('id', duplicatesToDelete)

      if (deleteError) throw deleteError
    }

    return duplicatesToDelete.length
  },

  async removeDuplicateChecklists() {
    if (!this.currentUser) throw new Error('Not authenticated')

    // Get all checklists for current user
    const { data: checklists, error } = await supabaseClient
      .from('checklists')
      .select('*')
      .eq('user_id', this.currentUser.id)
      .order('created_at', { ascending: true }) // Keep oldest

    if (error) throw error

    // Group by name to find duplicates
    const seen = new Map()
    const duplicatesToDelete = []

    checklists.forEach(checklist => {
      const key = checklist.name
      if (seen.has(key)) {
        // This is a duplicate, mark for deletion
        duplicatesToDelete.push(checklist.id)
      } else {
        // First occurrence, keep it
        seen.set(key, checklist.id)
      }
    })

    // Delete duplicates
    if (duplicatesToDelete.length > 0) {
      const { error: deleteError } = await supabaseClient
        .from('checklists')
        .delete()
        .in('id', duplicatesToDelete)

      if (deleteError) throw deleteError
    }

    return duplicatesToDelete.length
  },

  // ==================== DELETE ALL DATA ====================

  async deleteAllUserData() {
    if (!this.currentUser) throw new Error('Not authenticated')

    const userId = this.currentUser.id

    try {
      // Delete all gear items
      const { error: itemsError } = await supabaseClient
        .from('gear_items')
        .delete()
        .eq('user_id', userId)

      if (itemsError) throw itemsError

      // Delete all checklists
      const { error: checklistsError } = await supabaseClient
        .from('checklists')
        .delete()
        .eq('user_id', userId)

      if (checklistsError) throw checklistsError

      // Delete category order
      const { error: categoryError } = await supabaseClient
        .from('category_order')
        .delete()
        .eq('user_id', userId)

      if (categoryError) throw categoryError

      return true
    } catch (error) {
      console.error('Error deleting all user data:', error)
      throw error
    }
  },

  // ==================== SHARING ====================

  // Create a share link for a gear item
  async createShareLink(itemId, item) {
    if (!this.currentUser) throw new Error('Not authenticated')

    // Generate unique share code
    const shareCode = this.generateShareCode()

    // Create share record (item data passed from client to avoid extra DB query)
    const { data, error } = await supabaseClient
      .from('shared_items')
      .insert([{
        share_code: shareCode,
        item_id: itemId,
        owner_id: this.currentUser.id,
        item_data: {
          category: item.category,
          name: item.name,
          brand: item.brand,
          model: item.model,
          weight: item.weight,
          price: item.price,
          year: item.year,
          rating: item.rating,
          image_path: item.image_path
        },
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days
      }])
      .select()
      .single()

    if (error) throw error
    return { shareCode, shareUrl: `${window.location.origin}${window.location.pathname}?share=${shareCode}` }
  },

  // Get shared item by code (no auth required)
  async getSharedItem(shareCode) {
    const { data, error } = await supabaseClient
      .from('shared_items')
      .select('*')
      .eq('share_code', shareCode)
      .single()

    if (error) throw error
    if (!data) throw new Error('Shared item not found')

    // Check if expired
    if (new Date(data.expires_at) < new Date()) {
      throw new Error('Share link has expired')
    }

    // Get image URL if exists
    let imageUrl = null
    if (data.item_data.image_path) {
      imageUrl = await this.getPhotoUrl(data.item_data.image_path)
    }

    return {
      ...data.item_data,
      image: imageUrl,
      shareCode: data.share_code,
      ownerId: data.owner_id
    }
  },

  // Save shared item to user's collection
  async saveSharedItem(shareCode) {
    if (!this.currentUser) throw new Error('Not authenticated')

    // Get the shared item
    const sharedItem = await this.getSharedItem(shareCode)

    // Check if user is trying to save their own item
    if (sharedItem.ownerId === this.currentUser.id) {
      throw new Error('You already own this item')
    }

    // Create new item with copied data
    const newItem = {
      id: crypto.randomUUID(),
      category: sharedItem.category,
      name: sharedItem.name,
      brand: sharedItem.brand,
      model: sharedItem.model,
      weight: sharedItem.weight,
      price: sharedItem.price,
      year: sharedItem.year,
      rating: sharedItem.rating,
      image: sharedItem.image_path || null, // Will be copied as image_path
      created: Date.now()
    }

    await this.createGearItem(newItem)
    return newItem
  },

  // Generate random share code
  generateShareCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
    let code = ''
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return code
  },

  // ==================== STORAGES ====================

  async getAllStorages() {
    if (!this.currentUser) return []

    const { data, error } = await supabaseClient
      .from('storages')
      .select('*')
      .eq('user_id', this.currentUser.id)
      .order('name', { ascending: true })

    if (error) throw error
    return (data || []).map(row => this.mapStorage(row))
  },

  async createStorage(nameOrStorage) {
    if (!this.currentUser) throw new Error('Not authenticated')

    const storage = typeof nameOrStorage === 'string'
      ? { name: nameOrStorage }
      : (nameOrStorage || {})

    const { data, error } = await supabaseClient
      .from('storages')
      .insert({
        user_id: this.currentUser.id,
        name: storage.name.trim(),
        address: storage.address || null,
        description: storage.description || null,
        rating: storage.rating || 0,
        ...window.VisibilityUI.buildResourceSavePayload(storage)
      })
      .select()
      .single()

    if (error) throw error
    return this.mapStorage(data)
  },

  async updateStorage(id, nameOrUpdates) {
    if (!this.currentUser) throw new Error('Not authenticated')

    const updates = typeof nameOrUpdates === 'string'
      ? { name: nameOrUpdates }
      : (nameOrUpdates || {})

    const visibilityUpdates = updates.visibility !== undefined
      ? window.VisibilityUI.buildResourceSavePayload(updates)
      : {}

    const updateData = {
      name: updates.name !== undefined ? updates.name.trim() : undefined,
      address: updates.address !== undefined ? (updates.address || null) : undefined,
      description: updates.description !== undefined ? (updates.description || null) : undefined,
      rating: updates.rating !== undefined ? (updates.rating || 0) : undefined,
      ...visibilityUpdates,
      updated_at: new Date().toISOString()
    }

    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) delete updateData[key]
    })

    const { data, error } = await supabaseClient
      .from('storages')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', this.currentUser.id)
      .select()
      .single()

    if (error) throw error
    return this.mapStorage(data)
  },

  async deleteStorage(id) {
    if (!this.currentUser) throw new Error('Not authenticated')

    const { error } = await supabaseClient
      .from('storages')
      .delete()
      .eq('id', id)
      .eq('user_id', this.currentUser.id)

    if (error) throw error
  },

  // ==================== CHECKLIST SHARING ====================

  // Create a share link for a checklist
  async createChecklistShare(checklistId, checklist) {
    if (!this.currentUser) throw new Error('Not authenticated')

    // Generate unique share code
    const shareCode = this.generateShareCode()

    // Prepare checklist data (passed from client to avoid DB query)
    const checklistData = window.AppHelpers.buildChecklistShareData(checklist)

    // Create share record (reusing shared_items table with checklist_id field)
    const { data, error } = await supabaseClient
      .from('shared_items')
      .insert([{
        share_code: shareCode,
        checklist_id: checklistId,
        owner_id: this.currentUser.id,
        item_data: checklistData,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days
      }])
      .select()
      .single()

    if (error) throw error
    return {
      shareCode,
      shareUrl: window.AppHelpers.buildChecklistShareUrl(window.location.origin, window.location.pathname, shareCode)
    }
  },

  // Get shared checklist by code (no auth required)
  async getSharedChecklist(shareCode) {
    const { data, error } = await supabaseClient
      .from('shared_items')
      .select('*')
      .eq('share_code', shareCode)
      .single()

    if (error) throw error
    if (!data) throw new Error('Shared checklist not found')

    // Check if expired
    if (new Date(data.expires_at) < new Date()) {
      throw new Error('Share link has expired')
    }

    // Load images for items
    const checklistData = data.item_data
    if (checklistData.items) {
      for (const item of checklistData.items) {
        if (item.image_path) {
          item.image = await this.getPhotoUrl(item.image_path)
        }
      }
    }

    return {
      ...checklistData,
      shareCode: data.share_code,
      ownerId: data.owner_id
    }
  }
}

window.SupabaseService = SupabaseService
