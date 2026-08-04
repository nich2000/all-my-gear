# Administration and role matrix

The administration UI is served at `/admin`. The regular application UI does not
contain links or buttons leading to this route.

## Roles

| Capability | User | Admin | Superadmin |
| --- | --- | --- | --- |
| Use the regular application | Yes | Yes | Yes |
| Open `/admin` | No | Yes | Yes |
| View users | No | Yes | Yes |
| Edit safe user profile fields | No | Yes | Yes |
| Assign application roles | No | No | Yes |
| View catalogs | No | Yes | Yes |
| Edit categories, brands and activities | No | Yes | Yes |
| View roles and permissions | No | Yes | Yes |
| Edit role permissions | No | No | Yes |
| View subscriptions | No | Yes | Yes |
| Create and edit subscriptions | No | Yes | Yes |

Every account has the `user` role. Administrative roles are additional roles.
An administrator cannot grant roles or change the permission matrix, so an
administrator cannot promote themselves to superadmin. A superadmin cannot remove
their own superadmin role, and administrative roles cannot lose the
`admin.access` permission.

## Security boundary

The HTML, CSS and JavaScript for `/admin` contain no privileged credentials.
The browser uses the normal Supabase authenticated session. Every administration
RPC checks a database permission before reading or changing protected data.
Direct access to the role tables is revoked from the `anon` and `authenticated`
database roles, and row-level security is enabled.

The user editor intentionally changes only the nickname and application roles.
Email and password changes remain in Supabase Auth workflows so the admin UI does
not bypass identity verification or provider synchronization.

## Initial superadmins

Migration `202607270001_admin_roles_and_api.sql` assigns both `user` and
`superadmin` to:

- `nich2000@mail.ru`
- `ili.gurevich@gmail.com`
- `nikolai.svistoun@gmail.com`

The same migration installs an Auth trigger so a newly created account with one
of these exact normalized email addresses receives the same roles.
