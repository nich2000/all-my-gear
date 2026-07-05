(function(root) {
  const VISIBILITIES = ['public', 'private', 'shared']
  const VISIBILITY_LABELS = {
    public: 'Public',
    private: 'Private',
    shared: 'Shared'
  }
  const ACCESS_SOURCE_LABELS = {
    mine: 'Mine',
    public: 'Public',
    shared: 'Shared with me'
  }

  function normalizeVisibility(value) {
    return VISIBILITIES.includes(value) ? value : 'public'
  }

  function hasPrivateVisibility(entitlements) {
    return Boolean(
      entitlements?.canUsePrivateVisibility ||
      entitlements?.can_use_private_visibility ||
      entitlements?.can_make_private ||
      entitlements?.can_share_with_users ||
      entitlements?.private_visibility_enabled ||
      entitlements?.isSubscriber ||
      entitlements?.is_subscriber
    )
  }

  function canSelectVisibility(visibility, entitlements) {
    const normalized = normalizeVisibility(visibility)
    return normalized === 'public' || hasPrivateVisibility(entitlements)
  }

  function canEditResource(resource) {
    const accessSource = resource?.accessSource || resource?.access_source
    return accessSource === 'mine'
  }

  function getVisibilityOptions(entitlements) {
    return VISIBILITIES.map(value => ({
      value,
      label: VISIBILITY_LABELS[value],
      disabled: !canSelectVisibility(value, entitlements)
    }))
  }

  function normalizeAccessSource(row, currentUserId) {
    const source = row?.accessSource || row?.access_source
    if (source) return source
    const ownerId = row?.userId || row?.user_id || row?.owner_id
    if (currentUserId && ownerId === currentUserId) return 'mine'
    return normalizeVisibility(row?.visibility) === 'shared' ? 'shared' : 'public'
  }

  function mapGearRowToModel(row, currentUserId) {
    const visibility = normalizeVisibility(row?.visibility)
    return {
      ...row,
      userId: row?.user_id ?? row?.userId,
      image: row?.image_path ?? row?.image,
      image_path: row?.image_path ?? row?.image,
      storageId: row?.storage_id ?? row?.storageId ?? null,
      visibility,
      publishedAt: row?.published_at ?? row?.publishedAt ?? null,
      published_at: row?.published_at ?? row?.publishedAt ?? null,
      accessSource: normalizeAccessSource(row, currentUserId),
      access_source: normalizeAccessSource(row, currentUserId)
    }
  }

  function mapChecklistRowToModel(row, currentUserId) {
    const visibility = normalizeVisibility(row?.visibility)
    return {
      ...row,
      userId: row?.user_id ?? row?.userId,
      tags: row?.activities ?? row?.tags ?? [],
      startDate: row?.start_date ?? row?.startDate ?? null,
      endDate: row?.end_date ?? row?.endDate ?? null,
      visibility,
      publishedAt: row?.published_at ?? row?.publishedAt ?? null,
      published_at: row?.published_at ?? row?.publishedAt ?? null,
      accessSource: normalizeAccessSource(row, currentUserId),
      access_source: normalizeAccessSource(row, currentUserId)
    }
  }

  function mapStorageRowToModel(row, currentUserId) {
    const visibility = normalizeVisibility(row?.visibility)
    return {
      ...row,
      userId: row?.user_id ?? row?.userId,
      address: row?.address ?? '',
      description: row?.description ?? '',
      rating: row?.rating ?? 0,
      visibility,
      publishedAt: row?.published_at ?? row?.publishedAt ?? null,
      published_at: row?.published_at ?? row?.publishedAt ?? null,
      accessSource: normalizeAccessSource(row, currentUserId),
      access_source: normalizeAccessSource(row, currentUserId)
    }
  }

  function buildResourceSavePayload(resource) {
    const visibility = normalizeVisibility(resource?.visibility)
    const payload = { visibility }
    const publishedAt = resource?.published_at ?? resource?.publishedAt
    if (publishedAt !== undefined) {
      payload.published_at = publishedAt
    } else if (visibility === 'public') {
      payload.published_at = new Date().toISOString()
    } else {
      payload.published_at = null
    }
    return payload
  }

  function getSearchResultBadges(resource) {
    const visibility = normalizeVisibility(resource?.visibility)
    const accessSource = resource?.accessSource || resource?.access_source || visibility
    return {
      visibility: VISIBILITY_LABELS[visibility],
      source: ACCESS_SOURCE_LABELS[accessSource] || (accessSource === 'shared_with_me' ? ACCESS_SOURCE_LABELS.shared : ACCESS_SOURCE_LABELS.public)
    }
  }

  function sanitizeChecklistPublicSnapshot(checklist) {
    return {
      ...checklist,
      items: (checklist?.items || []).map(item => ({
        itemId: item.itemId || item.id || '',
        name: item.name || '',
        category: item.category || '',
        brand: item.brand || '',
        model: item.model || '',
        weight: Number(item.weight) || 0,
        rating: Number(item.rating) || 0,
        checked: Boolean(item.checked)
      }))
    }
  }

  function renderVisibilityPicker(container, options = {}) {
    if (!container) return null
    const selected = normalizeVisibility(options.value)
    const entitlements = options.entitlements || {}
    const grants = Array.isArray(options.grants) ? options.grants : []

    container.classList.add('visibility-picker')
    container.innerHTML = `
      <div class="visibility-options">
        ${getVisibilityOptions(entitlements).map(option => `
          <label class="visibility-option${option.disabled ? ' disabled' : ''}">
            <input type="radio" name="${options.name || 'visibility'}" value="${option.value}" ${selected === option.value ? 'checked' : ''} ${option.disabled ? 'disabled' : ''}>
            <span>${option.label}</span>
          </label>
        `).join('')}
      </div>
      <div class="visibility-locked-message" style="display:${hasPrivateVisibility(entitlements) ? 'none' : 'block'}">Private and Shared are available for subscribed users.</div>
      <div class="visibility-grantees" style="display:${selected === 'shared' ? 'block' : 'none'}">
        ${grants.length ? grants.map(grant => `<span class="visibility-grantee">${escapeHtml(grant.email || grant.grantee_email || grant.user_id || grant.grantee_user_id || '')}</span>`).join('') : '<span class="visibility-grantee muted">No people shared yet</span>'}
      </div>
    `

    container.querySelectorAll('input[type="radio"]').forEach(input => {
      input.addEventListener('change', () => {
        const grantees = container.querySelector('.visibility-grantees')
        if (grantees) grantees.style.display = input.value === 'shared' && input.checked ? 'block' : 'none'
      })
    })

    return container
  }

  function getSelectedVisibility(container) {
    const checked = container?.querySelector('input[type="radio"]:checked')
    return normalizeVisibility(checked?.value)
  }

  function renderVisibilityBadge(resource) {
    const badges = getSearchResultBadges(resource)
    return `<span class="visibility-badge visibility-${normalizeVisibility(resource?.visibility)}">${badges.visibility}</span><span class="access-source-badge">${badges.source}</span>`
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;')
  }

  const api = {
    buildResourceSavePayload,
    canEditResource,
    canSelectVisibility,
    getSearchResultBadges,
    getSelectedVisibility,
    getVisibilityOptions,
    hasPrivateVisibility,
    mapChecklistRowToModel,
    mapGearRowToModel,
    mapStorageRowToModel,
    normalizeVisibility,
    renderVisibilityBadge,
    renderVisibilityPicker,
    sanitizeChecklistPublicSnapshot
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }

  root.VisibilityUI = api
})(typeof window !== 'undefined' ? window : globalThis)
