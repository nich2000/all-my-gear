import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const serviceSource = readFileSync(new URL('../www/js/supabase-service.js', import.meta.url), 'utf8')
const appHelpersSource = readFileSync(new URL('../www/js/app-helpers.js', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../www/js/app.js', import.meta.url), 'utf8')

test('supabase service exposes entitlement API across browser scripts', () => {
  assert.match(serviceSource, /async getCurrentUserEntitlements\(\)/)
  assert.match(serviceSource, /window\.SupabaseService\s*=\s*SupabaseService/)
})

test('supabase service loads category catalog and user category preferences from database', () => {
  assert.match(serviceSource, /async getCategories\(\)/)
  assert.match(serviceSource, /\.from\('categories'\)/)
  assert.match(serviceSource, /\.from\('user_category_preferences'\)/)
  assert.match(serviceSource, /category:categories\(id,\s*name\)/)
})

test('frontend does not keep a hardcoded category catalog fallback', () => {
  assert.doesNotMatch(appHelpersSource, /DEFAULT_GEAR_CATEGORIES/)
  assert.doesNotMatch(serviceSource, /DEFAULT_GEAR_CATEGORIES/)
  assert.doesNotMatch(appSource, /DEFAULT_GEAR_CATEGORIES/)
  assert.doesNotMatch(appSource, /const\s+defaultCategories\s*=\s*\[/)
})

test('supabase service loads outdoor brand catalog from database', () => {
  assert.match(serviceSource, /async getOutdoorBrands\(\)/)
  assert.match(serviceSource, /\.from\('outdoor_brands'\)/)
  assert.match(serviceSource, /\.select\('id, name, display_name'\)/)
  assert.match(serviceSource, /\.eq\('is_active', true\)/)
  assert.match(serviceSource, /\.order\('display_name', \{ ascending: true \}\)/)
})

test('frontend brand autocomplete is rendered from loaded outdoor brands', () => {
  assert.match(appSource, /let outdoorBrands = \[\]/)
  assert.match(appSource, /outdoorBrands = await SupabaseService\.getOutdoorBrands\(\)/)
  assert.match(appSource, /function renderBrandOptions\(brandList\)/)
  assert.match(appSource, /renderBrandOptions\(brandList\)/)
  assert.doesNotMatch(appSource, /const\s+outdoorBrands\s*=\s*\[\.\.\.new Set\(\[/)
  assert.doesNotMatch(appSource, /Outdoor gear brands database - comprehensive list/)
})

test('supabase service loads outdoor activity catalog from database', () => {
  assert.match(serviceSource, /async getOutdoorActivities\(\)/)
  assert.match(serviceSource, /\.from\('outdoor_activities'\)/)
  assert.match(serviceSource, /\.select\('id, name, display_name'\)/)
  assert.match(serviceSource, /\.eq\('is_active', true\)/)
  assert.match(serviceSource, /\.order\('display_name', \{ ascending: true \}\)/)
})

test('frontend checklist activity controls are rendered from loaded outdoor activities', () => {
  assert.match(appSource, /let outdoorActivities = \[\]/)
  assert.match(appSource, /outdoorActivities = await SupabaseService\.getOutdoorActivities\(\)/)
  assert.match(appSource, /function loadOutdoorActivities\(\)/)
  assert.doesNotMatch(appSource, /const\s+outdoorActivities\s*=\s*\[/)
  assert.doesNotMatch(appSource, /Outdoor activities database/)
})

test('frontend category controls are rendered from loaded category order', () => {
  assert.match(appSource, /function renderCategoryOptions\(selectedCategory\)/)
  assert.match(appSource, /const orderedCategories = Array\.isArray\(categoryOrder\) \? \[\.\.\.categoryOrder\] : \[\]/)
  assert.match(appSource, /\$\{renderCategoryOptions\(it\.category\)\}/)
  assert.match(appSource, /const allCategories = Array\.isArray\(categoryOrder\) \? categoryOrder : \[\]/)
  assert.doesNotMatch(appSource, /<option value=["']Shelter["']/)
  assert.doesNotMatch(appSource, /<option value=\\["']Shelter\\["']/)
})

test('saving category preferences fails before deleting rows when a category is missing from the database catalog', () => {
  assert.match(serviceSource, /const missingCategoryNames = categoryData\.filter/)
  assert.match(serviceSource, /throw new Error\(`Unknown categories: \$\{missingCategoryNames\.join\(', '\)\}`\)/)

  const missingCategoryCheckIndex = serviceSource.indexOf('const missingCategoryNames = categoryData.filter')
  const deletePreferencesIndex = serviceSource.indexOf(".from('user_category_preferences')\n      .delete()")

  assert.ok(missingCategoryCheckIndex > -1, 'saveCategoryOrder must compute missing category names')
  assert.ok(deletePreferencesIndex > -1, 'saveCategoryOrder must delete existing preference rows after validation')
  assert.ok(
    missingCategoryCheckIndex < deletePreferencesIndex,
    'unknown categories must be rejected before existing preference rows are deleted'
  )
})

test('missing entitlements schema uses quiet free-plan fallback', () => {
  assert.match(serviceSource, /isMissingEntitlementsSchemaError\(error\)/)
  assert.match(serviceSource, /error\.code\s*===\s*'PGRST205'/)
  assert.match(serviceSource, /console\.info\('Entitlements schema is not available; using free visibility defaults'/)
})

test('missing visible search RPCs use quiet empty-result fallback', () => {
  assert.match(serviceSource, /isMissingVisibleSearchRpcError\(error,\s*rpcName\)/)
  assert.match(serviceSource, /error\.code\s*===\s*'PGRST202'/)
  assert.match(serviceSource, /return this\.handleVisibleSearchError\(error,\s*'search_visible_gear'\)/)
  assert.match(serviceSource, /return this\.handleVisibleSearchError\(error,\s*'search_visible_checklists'\)/)
  assert.match(serviceSource, /return this\.handleVisibleSearchError\(error,\s*'search_visible_storages'\)/)
})

test('gear item photo writes upload data URLs instead of persisting base64 in image_path', () => {
  assert.match(serviceSource, /async resolveGearItemImagePath\(itemId,\s*image\)/)
  assert.match(serviceSource, /return await this\.uploadPhoto\(itemId,\s*image\)/)
  assert.match(serviceSource, /const imagePath = await this\.resolveGearItemImagePath\(item\.id,\s*item\.image\)/)
  assert.match(serviceSource, /const imageToSave = Object\.prototype\.hasOwnProperty\.call\(updates,\s*'image'\)/)
  assert.doesNotMatch(serviceSource, /save base64 directly/)
  assert.doesNotMatch(serviceSource, /image_path:\s*item\.image\s*\|\|\s*null/)
})

test('gear item photo paths start with item id for storage RLS policies', () => {
  assert.match(serviceSource, /const filePath = `\$\{itemId\}\/image\.jpg`/)
  assert.doesNotMatch(serviceSource, /const filePath = `\$\{this\.currentUser\.id\}\//)
})

test('visible gear search resolves storage paths before rendering images', () => {
  assert.match(serviceSource, /async resolveGearPhotoUrls\(items\)/)
  assert.match(serviceSource, /await this\.getPhotoUrlsBatch\(imagePaths\)/)
  assert.match(serviceSource, /image: item\.image_path \? \(photoUrls\[item\.image_path\] \|\| null\) : item\.image/)
  assert.match(serviceSource, /return this\.filterVisibleResults\(await this\.resolveGearPhotoUrls\(\(data \|\| \[\]\)\.map\(row => this\.mapGearItem\(row\)\)\),\s*filters\)/)
})
