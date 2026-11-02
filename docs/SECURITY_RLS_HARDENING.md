# SynthesisOne — RLS backend-only hardening

## Qué protege

La migración `035_public_schema_backend_only_rls.sql` extiende la protección existente `021_backend_only_rls_hardening.sql` a las tablas, particiones, vistas, vistas materializadas, secuencias y funciones de aplicación que estén en `public` cuando se ejecute. Activa y fuerza RLS en todas las tablas/particiones no pertenecientes a extensiones, retira privilegios de `PUBLIC`, `anon` y `authenticated`, y conserva el acceso de `service_role` utilizado por el backend. También configura privilegios por defecto para los objetos futuros creados por el rol que ejecuta la migración.

Las políticas de Storage no se modifican. Esto evita alterar los buckets de miniaturas públicas y documentos privados, que necesitan reglas distintas.

**Alcance para objetos futuros:** la migración establece privilegios por defecto en `public` para los objetos creados por el mismo rol que la ejecuta y concede al backend acceso a esos objetos. PostgreSQL no dispone de un `ALTER DEFAULT PRIVILEGES` que active RLS automáticamente; cada migración que cree una tabla nueva debe incluir también `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` y `ALTER TABLE ... FORCE ROW LEVEL SECURITY`. Cada función o procedimiento nuevo debe revocar explícitamente `EXECUTE` de `PUBLIC`, `anon` y `authenticated` y concederlo a `service_role`. Importante: los `REVOKE` por esquema no anulan concesiones globales configuradas en `pg_default_acl`; por eso hay que revisar los privilegios por defecto globales del rol creador y comprobar los permisos efectivos después de cada migración. Si el despliegue crea objetos con otro propietario, hay que configurar/verificar también ese rol propietario.

## Despliegue seguro

1. Exporta un backup reciente de la base de datos y verifica que puedes restaurarlo.
2. Abre el proyecto Supabase de producción y ejecuta la migración completa desde SQL Editor o mediante el mecanismo habitual de migraciones.
3. Comprueba que termina con `COMMIT` sin errores. No ejecutes solo una parte del script.
4. Despliega el backend actualizado. No cambies `SUPABASE_URL` ni `SUPABASE_SERVICE_KEY` como parte de este cambio.
5. Verifica login, `/readyz`, catálogo, creación de pedidos Wallet, consulta de historial, reconciliación SMS y operaciones administrativas antes de dar por cerrada la publicación.

## Consultas de verificación

```sql
-- Debe devolver cero tablas de aplicación sin RLS.
select t.schemaname, t.tablename,
       c.relrowsecurity as row_security_enabled,
       c.relforcerowsecurity as row_security_forced
from pg_tables t
join pg_class c on c.relname = t.tablename
join pg_namespace n on n.oid = c.relnamespace and n.nspname = t.schemaname
where t.schemaname = 'public'
  and not exists (
    select 1 from pg_depend d
    where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e'
  )
  and (not c.relrowsecurity or not c.relforcerowsecurity);

-- Debe devolver cero filas con acceso efectivo de anon/authenticated.
select n.nspname as schema_name, c.relname as object_name,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_can_select,
       has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_can_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p', 'v', 'm', 'f')
  and (has_table_privilege('anon', c.oid, 'SELECT')
       or has_table_privilege('authenticated', c.oid, 'SELECT'))
order by c.relname;

-- Debe devolver cero filas: rutinas ejecutables por roles cliente.
select p.proname as routine_name,
       pg_get_function_identity_arguments(p.oid) as identity_arguments,
       r.rolname as role_name,
       has_function_privilege(r.rolname, p.oid, 'EXECUTE') as can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join pg_roles r
where n.nspname = 'public'
  and r.rolname in ('anon', 'authenticated')
  and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
order by p.proname, r.rolname;
```

Las consultas de privilegios deben revisarse también frente a las funciones/extensiones que el proyecto utilice conscientemente. La migración excluye objetos que pertenecen a extensiones, pero no sustituye una auditoría de configuración de Storage, Auth, Edge Functions, logs, claves ni políticas específicas de cada bucket.

## Importante

- La APK nunca debe incluir la clave `service_role`; solo el backend debe tenerla como secreto de entorno.
- La app actual utiliza el backend como única capa de acceso a las tablas de `public`. Si en el futuro se implementa acceso directo desde Android con `anon`/`authenticated`, habrá que diseñar políticas por usuario y tabla antes de conceder privilegios.
- La migración no se aplica automáticamente a Supabase desde este paquete. Debe ejecutarse en el proyecto correcto de producción, después del backup.
- La migración no cambia ni borra filas, pero restringe el acceso directo a `public` de `anon`/`authenticated`. No la ejecutes hasta confirmar que las integraciones activas no leen estas tablas directamente con esas claves.
- PostgreSQL concede `EXECUTE` a `PUBLIC` por defecto en funciones nuevas si los privilegios globales no se han endurecido. El `REVOKE` por esquema de esta migración no puede anular un permiso global preexistente. Revisa `pg_default_acl` para el rol que crea las funciones y añade `REVOKE` explícitos en cada nueva función/procedimiento. No se altera aquí el default global porque podría afectar funciones futuras de otros esquemas administrados por Supabase.
- No se puede certificar la seguridad total sin inspeccionar el estado real del proyecto Supabase, los permisos del proyecto, las políticas de Storage, los secretos y los registros de acceso.
