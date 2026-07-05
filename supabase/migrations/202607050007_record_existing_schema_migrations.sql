insert into public.schema_migrations (filename, checksum_sha256, source)
values
  ('202607030001_initial_public_schema.sql', 'b305630048c9e94af99899f50ace29415fc6ab86e0262a7f20867023a6718e75', 'backfill'),
  ('202607030002_drop_public_gear_shares.sql', '4ca049a5306897f1f4e5e80d9516f6078836ec774c30f0cd256529561dc2a29f', 'backfill'),
  ('202607030003_harden_existing_constraints.sql', '9b18a81d564a04727c4eb80142c44b7fc5d6c69535f5e8a009c7c325cfeece0e', 'backfill'),
  ('202607030004_fix_msr_quick_2_image_path.sql', 'f3a7bf7253b9e1dca9bb096a7f4f878d7a5a0fc6559be4d6ed747ea4212d9d99', 'backfill'),
  ('202607030005_subscription_visibility_access.sql', 'ebb494522094ea9026e6e4e4f86f64dfd2f142f9fc5ce53c8ed6cbe179b8fe45', 'backfill'),
  ('202607030006_normalize_categories.sql', 'fc77f3ad203cf66247bde1ad341bab3717fd8cd1457d672236f6a1d7845d3922', 'backfill'),
  ('202607030007_normalize_outdoor_brands.sql', 'dddb6cac5d999bfcbce9ddf325cca8f5599e555ddc699b11f0ba1794b42e3d5e', 'backfill'),
  ('202607030008_normalize_outdoor_activities.sql', '2471166792eaa93a895551eecd39eef945897d6d8f1ff0dc07a291c5ae3bcb52', 'backfill'),
  ('202607030009_add_query_path_indexes.sql', '8ef300f3ceb88bf2fa0a8b81847eac5d2d937cf68127f91995e93d56d04aefc5', 'backfill'),
  ('202607050001_fix_visible_gear_card_contract.sql', '7e7008ea9b1c7997c5b0b7fde36e847bdfefb631fd87d4a187084ab688fed218', 'backfill'),
  ('202607050002_harden_subscription_entitlement_security.sql', 'daf9e21e0b6ed9312c9940138fa40a77fea199063c22915800ee4f1b9f25e6ef', 'backfill'),
  ('202607050003_harden_catalog_search_security.sql', 'e04deb788b9314fa5e86e67c1733ba7a0b765823ad5d0efd9d3392d93e9ef1c0', 'backfill'),
  ('202607050004_fix_auth_rls_initplan_policies.sql', '717e3dd20463541d6a51b823275bf3a6f9176307966c6ab1cd94c1aacde0e234', 'backfill'),
  ('202607050005_add_fk_covering_indexes.sql', '8c2757fdcb45715fb7b98bbff6eeafe13704b26d1a2fbd18c1f89b8109f4bbc5', 'backfill'),
  ('202607050006_create_schema_migrations.sql', '30f0460db34d172422f21dabfd73b7e8b947f95698f49ebc3165970a11679832', 'backfill')
on conflict (filename) do nothing;
