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
    shared: 'Shared with me',
    shared_by_me: 'Shared by me',
    shared_with_me: 'Shared with me'
  }

  function normalizeVisibility(value) {
    return VISIBILITIES.includes(value) ? value : 'public'
  }

  function hasPrivateVisibility(entitlements) {
    return Boolean(
      entitlements?.canUsePrivateVisibility ||
      entitlements?.can_use_private_visibility ||
      entitlements?.can_make_private ||
      entitlements?.private_visibility_enabled ||
      entitlements?.isSubscriber ||
      entitlements?.is_subscriber
    )
  }

  function hasSharedVisibility(entitlements) {
    return Boolean(
      entitlements?.canUseSharedVisibility ||
      entitlements?.can_use_shared_visibility ||
      entitlements?.can_share_with_users ||
      entitlements?.isSubscriber ||
      entitlements?.is_subscriber
    )
  }

  function canGrantEdit(entitlements) {
    return Boolean(
      entitlements?.canGrantEdit ||
      entitlements?.can_grant_edit ||
      entitlements?.isSubscriber ||
      entitlements?.is_subscriber
    )
  }

  function canSelectVisibility(visibility, entitlements) {
    const normalized = normalizeVisibility(visibility)
    if (normalized === 'public') return true
    if (normalized === 'private') return hasPrivateVisibility(entitlements)
    return hasSharedVisibility(entitlements)
  }

  function canEditResource(resource) {
    const accessSource = resource?.accessSource || resource?.access_source
    return accessSource === 'mine' ||
      resource?.canEdit === true ||
      resource?.can_edit === true ||
      resource?.accessRole === 'editor' ||
      resource?.access_role === 'editor'
  }

  function isResourceOwner(resource) {
    return (resource?.accessSource || resource?.access_source) === 'mine'
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
      shareDirection: row?.share_direction ?? row?.shareDirection ?? null,
      accessRole: row?.access_role ?? row?.accessRole ?? null,
      canEdit: row?.can_edit ?? row?.canEdit ?? false,
      recipientCount: row?.recipient_count ?? row?.recipientCount ?? 0,
      activeLinkCount: row?.active_link_count ?? row?.activeLinkCount ?? 0,
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
      shareDirection: row?.share_direction ?? row?.shareDirection ?? null,
      accessRole: row?.access_role ?? row?.accessRole ?? null,
      canEdit: row?.can_edit ?? row?.canEdit ?? false,
      recipientCount: row?.recipient_count ?? row?.recipientCount ?? 0,
      activeLinkCount: row?.active_link_count ?? row?.activeLinkCount ?? 0,
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
    const shareDirection = resource?.shareDirection || resource?.share_direction
    const accessRole = resource?.accessRole || resource?.access_role
    return {
      visibility: VISIBILITY_LABELS[visibility],
      source: ACCESS_SOURCE_LABELS[shareDirection] || ACCESS_SOURCE_LABELS[accessSource] || ACCESS_SOURCE_LABELS.public,
      role: accessRole === 'editor' ? 'Can edit' : (accessRole === 'viewer' ? 'View only' : null)
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
    const previousState = container._visibilityState
    const selected = normalizeVisibility(options.value ?? previousState?.visibility)
    const entitlements = options.entitlements || {}
    const grants = Array.isArray(options.grants)
      ? options.grants.map(normalizeRecipient)
      : (previousState?.recipients || [])
    const temporaryLinks = Array.isArray(options.temporaryLinks)
      ? options.temporaryLinks
      : (previousState?.temporaryLinks || [])
    const readOnlyAccess = Boolean(options.readOnlyAccess)

    container._visibilityState = {
      visibility: selected,
      recipients: grants,
      temporaryLinks,
      revokeTemporaryLinks: previousState?.revokeTemporaryLinks ?? true
    }

    container.classList.add('visibility-picker')
    container.innerHTML = `
      <div class="visibility-options">
        ${getVisibilityOptions(entitlements).map(option => `
          <label class="visibility-option${option.disabled ? ' disabled' : ''}">
            <input type="radio" name="${options.name || 'visibility'}" value="${option.value}" ${selected === option.value ? 'checked' : ''} ${option.disabled || readOnlyAccess ? 'disabled' : ''}>
            <span>${option.label}</span>
          </label>
        `).join('')}
      </div>
      <div class="visibility-locked-message" style="display:${hasPrivateVisibility(entitlements) && hasSharedVisibility(entitlements) ? 'none' : 'block'}">Private and Shared availability depends on your subscription.</div>
      <div class="visibility-grantees" style="display:${selected === 'shared' ? 'block' : 'none'}">
        ${readOnlyAccess ? '' : `
          <div class="visibility-recipient-add">
            <input type="email" class="visibility-recipient-email" placeholder="User email" autocomplete="off" aria-label="User email">
            <button type="button" class="btn secondary visibility-recipient-add-btn">Add user</button>
          </div>
          <div class="visibility-recipient-error" role="alert"></div>
        `}
        <div class="visibility-recipient-list">
          ${grants.length ? grants.map((grant, index) => renderRecipient(grant, index, entitlements, readOnlyAccess)).join('') : '<span class="visibility-grantee muted">No people shared yet</span>'}
        </div>
      </div>
      <div class="visibility-private-options" style="display:${selected === 'private' && temporaryLinks.length ? 'block' : 'none'}">
        <label class="visibility-revoke-links">
          <input type="checkbox" class="visibility-revoke-links-input" ${container._visibilityState.revokeTemporaryLinks ? 'checked' : ''} ${readOnlyAccess ? 'disabled' : ''}>
          <span>Revoke active temporary links</span>
        </label>
      </div>
      <div class="visibility-temporary-links" style="display:${temporaryLinks.length ? 'block' : 'none'}">
        <div class="visibility-links-title">Active temporary links</div>
        ${temporaryLinks.map(link => `
          <div class="visibility-link-row" data-link-id="${escapeHtml(link.id || '')}">
            <span>${escapeHtml(formatLinkExpiry(link.expires_at || link.expiresAt))}</span>
            ${readOnlyAccess ? '' : '<button type="button" class="visibility-link-revoke">Revoke</button>'}
          </div>
        `).join('')}
      </div>
    `

    container.querySelectorAll('input[type="radio"]').forEach(input => {
      input.addEventListener('change', () => {
        container._visibilityState.visibility = normalizeVisibility(input.value)
        const grantees = container.querySelector('.visibility-grantees')
        if (grantees) grantees.style.display = input.value === 'shared' && input.checked ? 'block' : 'none'
        const privateOptions = container.querySelector('.visibility-private-options')
        if (privateOptions) privateOptions.style.display = input.value === 'private' && input.checked && temporaryLinks.length ? 'block' : 'none'
      })
    })

    const addButton = container.querySelector('.visibility-recipient-add-btn')
    const emailInput = container.querySelector('.visibility-recipient-email')
    addButton?.addEventListener('click', () => {
      const email = String(emailInput?.value || '').trim().toLowerCase()
      const error = container.querySelector('.visibility-recipient-error')
      if (!email || !email.includes('@')) {
        if (error) error.textContent = 'Enter a valid user email.'
        return
      }
      if (container._visibilityState.recipients.some(recipient => recipient.email === email)) {
        if (error) error.textContent = 'This user is already in the list.'
        return
      }
      container._visibilityState.recipients.push({ email, role: 'viewer' })
      renderVisibilityPicker(container, {
        ...options,
        value: container._visibilityState.visibility,
        grants: container._visibilityState.recipients,
        temporaryLinks: container._visibilityState.temporaryLinks
      })
    })

    container.querySelectorAll('.visibility-recipient-edit').forEach(input => {
      input.addEventListener('change', () => {
        const index = Number(input.dataset.index)
        if (container._visibilityState.recipients[index]) {
          container._visibilityState.recipients[index].role = input.checked ? 'editor' : 'viewer'
        }
      })
    })

    container.querySelectorAll('.visibility-recipient-remove').forEach(button => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.index)
        container._visibilityState.recipients.splice(index, 1)
        renderVisibilityPicker(container, {
          ...options,
          value: container._visibilityState.visibility,
          grants: container._visibilityState.recipients,
          temporaryLinks: container._visibilityState.temporaryLinks
        })
      })
    })

    container.querySelector('.visibility-revoke-links-input')?.addEventListener('change', event => {
      container._visibilityState.revokeTemporaryLinks = event.target.checked
    })

    container.querySelectorAll('.visibility-link-revoke').forEach(button => {
      button.addEventListener('click', async () => {
        const row = button.closest('.visibility-link-row')
        const linkId = row?.dataset.linkId
        if (!linkId || typeof options.onRevokeLink !== 'function') return
        button.disabled = true
        try {
          await options.onRevokeLink(linkId)
          container._visibilityState.temporaryLinks = container._visibilityState.temporaryLinks.filter(link => link.id !== linkId)
          renderVisibilityPicker(container, {
            ...options,
            value: container._visibilityState.visibility,
            grants: container._visibilityState.recipients,
            temporaryLinks: container._visibilityState.temporaryLinks
          })
        } catch (error) {
          button.disabled = false
          const message = container.querySelector('.visibility-recipient-error')
          if (message) message.textContent = error.message || 'Failed to revoke link.'
        }
      })
    })

    return container
  }

  function normalizeRecipient(grant) {
    return {
      id: grant.id || null,
      user_id: grant.user_id || grant.grantee_user_id || null,
      email: String(grant.email || grant.grantee_email || '').trim().toLowerCase(),
      role: grant.role === 'editor' ? 'editor' : 'viewer'
    }
  }

  function renderRecipient(grant, index, entitlements, readOnlyAccess) {
    const email = grant.email || grant.user_id || 'Unknown user'
    return `
      <div class="visibility-recipient">
        <span class="visibility-grantee">${escapeHtml(email)}</span>
        <label class="visibility-enable-edit">
          <input type="checkbox" class="visibility-recipient-edit" data-index="${index}" ${grant.role === 'editor' ? 'checked' : ''} ${readOnlyAccess || !canGrantEdit(entitlements) ? 'disabled' : ''}>
          <span>Enable edit</span>
        </label>
        ${readOnlyAccess ? '' : `<button type="button" class="visibility-recipient-remove" data-index="${index}" aria-label="Remove ${escapeHtml(email)}">×</button>`}
      </div>
    `
  }

  function formatLinkExpiry(value) {
    if (!value) return 'Temporary link'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return 'Temporary link'
    return `Expires ${date.toLocaleDateString()}`
  }

  function getSelectedVisibility(container) {
    const checked = container?.querySelector('input[type="radio"]:checked')
    return normalizeVisibility(checked?.value ?? container?._visibilityState?.visibility)
  }

  function getAccessSettings(container) {
    const state = container?._visibilityState || {}
    return {
      visibility: getSelectedVisibility(container),
      recipients: (state.recipients || []).map(recipient => ({
        user_id: recipient.user_id || null,
        email: recipient.email || null,
        role: recipient.role === 'editor' ? 'editor' : 'viewer'
      })),
      revokeTemporaryLinks: Boolean(state.revokeTemporaryLinks)
    }
  }

  function renderVisibilityBadge(resource) {
    const badges = getSearchResultBadges(resource)
    const recipientCount = Number(resource?.recipientCount ?? resource?.recipient_count) || 0
    const linkCount = Number(resource?.activeLinkCount ?? resource?.active_link_count) || 0
    return [
      `<span class="visibility-badge visibility-${normalizeVisibility(resource?.visibility)}">${badges.visibility}</span>`,
      `<span class="access-source-badge">${badges.source}</span>`,
      badges.role ? `<span class="access-role-badge">${badges.role}</span>` : '',
      recipientCount ? `<span class="access-count-badge">${recipientCount} user${recipientCount === 1 ? '' : 's'}</span>` : '',
      linkCount ? `<span class="access-count-badge">${linkCount} link${linkCount === 1 ? '' : 's'}</span>` : ''
    ].join('')
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
    canGrantEdit,
    canEditResource,
    canSelectVisibility,
    getAccessSettings,
    getSearchResultBadges,
    getSelectedVisibility,
    getVisibilityOptions,
    hasPrivateVisibility,
    hasSharedVisibility,
    isResourceOwner,
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
