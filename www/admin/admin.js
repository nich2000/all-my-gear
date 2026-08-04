/* global SUPABASE_URL, SUPABASE_ANON_KEY, supabase */

const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const state = {
  user: null,
  context: null,
  users: [],
  roles: [],
  permissions: [],
  subscriptions: [],
  plans: [],
  catalog: [],
  catalogCode: 'categories',
  dialogSave: null
}

const elements = {
  loader: document.getElementById('loader'),
  authView: document.getElementById('authView'),
  forbiddenView: document.getElementById('forbiddenView'),
  adminView: document.getElementById('adminView'),
  loginForm: document.getElementById('loginForm'),
  loginError: document.getElementById('loginError'),
  notice: document.getElementById('notice'),
  usersTable: document.getElementById('usersTable'),
  rolesGrid: document.getElementById('rolesGrid'),
  subscriptionsTable: document.getElementById('subscriptionsTable'),
  catalogTable: document.getElementById('catalogTable'),
  catalogSelect: document.getElementById('catalogSelect'),
  dialog: document.getElementById('editDialog'),
  dialogTitle: document.getElementById('dialogTitle'),
  dialogFields: document.getElementById('dialogFields'),
  editForm: document.getElementById('editForm'),
  saveDialog: document.getElementById('saveDialog')
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function hasPermission(code) {
  return state.context?.permissions?.includes(code) === true
}

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

function rpcError(error) {
  return error?.message || 'Unexpected administration error'
}

async function rpc(name, params = {}) {
  const { data, error } = await client.rpc(name, params)
  if (error) throw error
  return data
}

function setView(view) {
  for (const element of [elements.loader, elements.authView, elements.forbiddenView, elements.adminView]) {
    element.classList.add('hidden')
  }
  view.classList.remove('hidden')
}

function notify(message, type = 'success') {
  elements.notice.textContent = message
  elements.notice.className = `notice ${type}`
  window.clearTimeout(notify.timer)
  notify.timer = window.setTimeout(() => elements.notice.classList.add('hidden'), 4500)
}

async function establishAccess() {
  elements.loader.classList.remove('hidden')
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) {
    state.user = null
    setView(elements.authView)
    return
  }

  state.user = user
  try {
    state.context = await rpc('get_my_admin_context')
  } catch (contextError) {
    console.error(contextError)
    setView(elements.forbiddenView)
    return
  }

  if (!state.context?.is_admin) {
    setView(elements.forbiddenView)
    return
  }

  document.getElementById('sessionEmail').textContent = user.email
  document.getElementById('sessionRoles').textContent = state.context.roles.join(', ')
  setView(elements.adminView)
  await loadUsers()
}

async function signOut() {
  await client.auth.signOut()
  state.user = null
  state.context = null
  setView(elements.authView)
}

elements.loginForm.addEventListener('submit', async event => {
  event.preventDefault()
  elements.loginError.classList.add('hidden')
  const submit = elements.loginForm.querySelector('button[type="submit"]')
  submit.disabled = true
  try {
    const { error } = await client.auth.signInWithPassword({
      email: document.getElementById('loginEmail').value.trim(),
      password: document.getElementById('loginPassword').value
    })
    if (error) throw error
    await establishAccess()
  } catch (error) {
    elements.loginError.textContent = rpcError(error)
    elements.loginError.classList.remove('hidden')
  } finally {
    submit.disabled = false
  }
})

document.getElementById('signOutBtn').addEventListener('click', signOut)
document.getElementById('forbiddenSignOut').addEventListener('click', signOut)
document.getElementById('googleSignIn').addEventListener('click', async () => {
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/admin` }
  })
  if (error) {
    elements.loginError.textContent = rpcError(error)
    elements.loginError.classList.remove('hidden')
  }
})

document.getElementById('adminNav').addEventListener('click', async event => {
  const button = event.target.closest('[data-section]')
  if (!button) return

  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item === button))
  document.querySelectorAll('.section').forEach(section => section.classList.remove('active'))
  document.getElementById(`${button.dataset.section}Section`).classList.add('active')

  try {
    if (button.dataset.section === 'users') await loadUsers()
    if (button.dataset.section === 'catalogs') await loadCatalog()
    if (button.dataset.section === 'roles') await loadRoles()
    if (button.dataset.section === 'subscriptions') await loadSubscriptions()
  } catch (error) {
    notify(rpcError(error), 'error')
  }
})

async function loadUsers() {
  state.users = await rpc('admin_list_users')
  renderUsers()
}

function renderUsers() {
  const query = document.getElementById('userSearch').value.trim().toLowerCase()
  const users = state.users.filter(user =>
    `${user.email} ${user.nickname}`.toLowerCase().includes(query)
  )
  if (!users.length) {
    elements.usersTable.innerHTML = '<div class="empty">No users found.</div>'
    return
  }

  elements.usersTable.innerHTML = `
    <table>
      <thead><tr><th>User</th><th>Roles</th><th>Created</th><th>Last sign-in</th><th></th></tr></thead>
      <tbody>${users.map(user => `
        <tr>
          <td><strong>${escapeHtml(user.email)}</strong><br><span class="muted">${escapeHtml(user.nickname || 'No nickname')}</span></td>
          <td>${user.role_codes.map(role => `<span class="pill">${escapeHtml(role)}</span>`).join('')}</td>
          <td>${escapeHtml(formatDate(user.created_at))}</td>
          <td>${escapeHtml(formatDate(user.last_sign_in_at))}</td>
          <td><button class="table-action" data-edit-user="${user.id}">Edit</button></td>
        </tr>
      `).join('')}</tbody>
    </table>`
}

document.getElementById('userSearch').addEventListener('input', renderUsers)
elements.usersTable.addEventListener('click', event => {
  const button = event.target.closest('[data-edit-user]')
  if (!button) return
  openUserDialog(state.users.find(user => user.id === button.dataset.editUser))
})

async function ensureRoles() {
  if (!state.roles.length) state.roles = await rpc('admin_list_roles')
}

async function openUserDialog(user) {
  await ensureRoles()
  const canAssignRoles = hasPermission('users.roles.update')
  const roleFields = canAssignRoles
    ? `<div class="permissions">${state.roles.map(role => `
        <label class="checkbox-row">
          <input type="checkbox" name="roles" value="${escapeHtml(role.code)}" ${user.role_codes.includes(role.code) ? 'checked' : ''} ${role.code === 'user' ? 'disabled' : ''}>
          ${escapeHtml(role.name)}
        </label>`).join('')}</div>`
    : `<div><span class="muted">Roles</span><br>${user.role_codes.map(role => `<span class="pill">${escapeHtml(role)}</span>`).join('')}</div>`

  openDialog(`Edit ${user.email}`, `
    <label>Nickname<input name="nickname" value="${escapeHtml(user.nickname)}" maxlength="100"></label>
    ${roleFields}
  `, async form => {
    await rpc('admin_update_user', {
      target_user_id: user.id,
      new_nickname: form.get('nickname')
    })
    if (canAssignRoles) {
      const roleCodes = form.getAll('roles')
      if (!roleCodes.includes('user')) roleCodes.push('user')
      await rpc('admin_update_user_roles', {
        target_user_id: user.id,
        new_role_codes: roleCodes
      })
    }
    await loadUsers()
    notify('User updated.')
  })
}

async function loadRoles() {
  const [roles, permissions] = await Promise.all([
    rpc('admin_list_roles'),
    rpc('admin_list_permissions')
  ])
  state.roles = roles
  state.permissions = permissions
  const canEdit = hasPermission('roles.update')
  elements.rolesGrid.innerHTML = roles.map(role => `
    <article class="role-card">
      <h3>${escapeHtml(role.name)} <span class="pill">${escapeHtml(role.code)}</span></h3>
      <p>${escapeHtml(role.description)}</p>
      <div>${role.permission_codes.map(code => `<span class="pill">${escapeHtml(code)}</span>`).join('') || '<span class="muted">No admin permissions</span>'}</div>
      ${canEdit ? `<p><button class="table-action" data-edit-role="${role.id}">Edit role</button></p>` : ''}
    </article>
  `).join('')
}

elements.rolesGrid.addEventListener('click', event => {
  const button = event.target.closest('[data-edit-role]')
  if (!button) return
  const role = state.roles.find(item => item.id === button.dataset.editRole)
  openDialog(`Edit ${role.code}`, `
    <label>Name<input name="name" value="${escapeHtml(role.name)}" required maxlength="100"></label>
    <label>Description<textarea name="description" rows="3">${escapeHtml(role.description)}</textarea></label>
    <div class="permissions">${state.permissions.map(permission => `
      <label class="checkbox-row" title="${escapeHtml(permission.description)}">
        <input type="checkbox" name="permissions" value="${escapeHtml(permission.code)}" ${role.permission_codes.includes(permission.code) ? 'checked' : ''}>
        ${escapeHtml(permission.name)}
      </label>`).join('')}</div>
  `, async form => {
    await rpc('admin_update_role', {
      target_role_id: role.id,
      new_name: form.get('name'),
      new_description: form.get('description'),
      new_permission_codes: form.getAll('permissions')
    })
    await loadRoles()
    notify('Role matrix updated.')
  })
})

async function loadCatalog() {
  state.catalogCode = elements.catalogSelect.value
  state.catalog = await rpc('admin_list_catalog', { catalog_code: state.catalogCode })
  renderCatalog()
}

function renderCatalog() {
  if (!state.catalog.length) {
    elements.catalogTable.innerHTML = '<div class="empty">The catalog is empty.</div>'
    return
  }

  elements.catalogTable.innerHTML = `
    <table>
      <thead><tr><th>Name</th><th>Normalized value</th><th>Order</th><th>Active</th><th></th></tr></thead>
      <tbody>${state.catalog.map(item => `
        <tr>
          <td>${escapeHtml(item.display_name || item.name)}</td>
          <td>${escapeHtml(item.slug || item.normalized_name || '—')}</td>
          <td>${escapeHtml(item.display_order)}</td>
          <td>${item.is_active ? 'Yes' : 'No'}</td>
          <td><button class="table-action" data-edit-catalog="${item.id}">Edit</button></td>
        </tr>`).join('')}
      </tbody>
    </table>`
}

elements.catalogSelect.addEventListener('change', () => loadCatalog().catch(error => notify(rpcError(error), 'error')))
document.getElementById('addCatalogItem').addEventListener('click', () => openCatalogDialog(null))
elements.catalogTable.addEventListener('click', event => {
  const button = event.target.closest('[data-edit-catalog]')
  if (!button) return
  openCatalogDialog(state.catalog.find(item => item.id === button.dataset.editCatalog))
})

function openCatalogDialog(item) {
  const isCategory = state.catalogCode === 'categories'
  openDialog(item ? 'Edit catalog item' : 'Add catalog item', `
    <label>Name<input name="name" value="${escapeHtml(item?.name)}" required></label>
    ${isCategory
      ? `<label>Slug<input name="slug" value="${escapeHtml(item?.slug)}"></label>`
      : `
        <label>Display name<input name="display_name" value="${escapeHtml(item?.display_name)}" required></label>
        <label>Normalized name<input name="normalized_name" value="${escapeHtml(item?.normalized_name)}" required></label>`
    }
    <label>Display order<input name="display_order" type="number" value="${escapeHtml(item?.display_order ?? state.catalog.length)}" required></label>
    <label class="checkbox-row"><input name="is_active" type="checkbox" ${item?.is_active !== false ? 'checked' : ''}> Active</label>
  `, async form => {
    const itemData = {
      name: form.get('name'),
      display_order: Number(form.get('display_order')),
      is_active: form.get('is_active') === 'on'
    }
    if (isCategory) {
      itemData.slug = form.get('slug')
    } else {
      itemData.display_name = form.get('display_name')
      itemData.normalized_name = form.get('normalized_name')
    }
    await rpc('admin_save_catalog_item', {
      catalog_code: state.catalogCode,
      item_id: item?.id || null,
      item_data: itemData
    })
    await loadCatalog()
    notify('Catalog item saved.')
  })
}

async function loadSubscriptions() {
  const [subscriptions, plans] = await Promise.all([
    rpc('admin_list_subscriptions'),
    rpc('admin_list_subscription_plans')
  ])
  state.subscriptions = subscriptions
  state.plans = plans
  if (!state.users.length) state.users = await rpc('admin_list_users')
  renderSubscriptions()
}

function renderSubscriptions() {
  if (!state.subscriptions.length) {
    elements.subscriptionsTable.innerHTML = '<div class="empty">No subscriptions.</div>'
    return
  }
  elements.subscriptionsTable.innerHTML = `
    <table>
      <thead><tr><th>User</th><th>Plan</th><th>Status</th><th>Period end</th><th></th></tr></thead>
      <tbody>${state.subscriptions.map(subscription => `
        <tr>
          <td>${escapeHtml(subscription.email)}</td>
          <td>${escapeHtml(subscription.plan_name)}</td>
          <td><span class="pill">${escapeHtml(subscription.status)}</span></td>
          <td>${escapeHtml(formatDate(subscription.current_period_end))}</td>
          <td><button class="table-action" data-edit-subscription="${subscription.id}">Edit</button></td>
        </tr>`).join('')}
      </tbody>
    </table>`
}

document.getElementById('addSubscription').addEventListener('click', () => openSubscriptionDialog(null))
elements.subscriptionsTable.addEventListener('click', event => {
  const button = event.target.closest('[data-edit-subscription]')
  if (!button) return
  openSubscriptionDialog(state.subscriptions.find(item => item.id === button.dataset.editSubscription))
})

function openSubscriptionDialog(subscription) {
  const endDate = subscription?.current_period_end
    ? new Date(subscription.current_period_end).toISOString().slice(0, 16)
    : ''
  openDialog(subscription ? 'Edit subscription' : 'Add subscription', `
    <label>User<select name="user_id" required>${state.users.map(user =>
      `<option value="${user.id}" ${subscription?.user_id === user.id ? 'selected' : ''}>${escapeHtml(user.email)}</option>`
    ).join('')}</select></label>
    <label>Plan<select name="plan_code" required>${state.plans.map(plan =>
      `<option value="${escapeHtml(plan.code)}" ${subscription?.plan_code === plan.code ? 'selected' : ''}>${escapeHtml(plan.name)}</option>`
    ).join('')}</select></label>
    <label>Status<select name="status">
      ${['active', 'trialing', 'past_due', 'canceled', 'expired'].map(status =>
        `<option value="${status}" ${subscription?.status === status ? 'selected' : ''}>${status}</option>`
      ).join('')}
    </select></label>
    <label>Period end (empty means perpetual)<input name="period_end" type="datetime-local" value="${endDate}"></label>
  `, async form => {
    const rawEnd = form.get('period_end')
    await rpc('admin_save_subscription', {
      subscription_id: subscription?.id || null,
      target_user_id: form.get('user_id'),
      target_plan_code: form.get('plan_code'),
      target_status: form.get('status'),
      period_end: rawEnd ? new Date(rawEnd).toISOString() : null
    })
    await loadSubscriptions()
    notify('Subscription saved.')
  })
}

function openDialog(title, fields, save) {
  elements.dialogTitle.textContent = title
  elements.dialogFields.innerHTML = fields
  state.dialogSave = save
  elements.dialog.showModal()
}

document.getElementById('closeDialog').addEventListener('click', event => {
  event.preventDefault()
  elements.dialog.close()
})

elements.editForm.addEventListener('submit', async event => {
  event.preventDefault()
  if (event.submitter?.value === 'cancel') {
    elements.dialog.close()
    return
  }
  if (!state.dialogSave) return
  elements.saveDialog.disabled = true
  try {
    await state.dialogSave(new FormData(elements.editForm))
    elements.dialog.close()
  } catch (error) {
    notify(rpcError(error), 'error')
  } finally {
    elements.saveDialog.disabled = false
  }
})

establishAccess().catch(error => {
  console.error(error)
  setView(elements.authView)
})
