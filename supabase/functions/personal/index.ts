// Edge Function "personal": crea cuentas del personal, cambia contraseñas y
// quita accesos. Solo la puede usar un usuario con rol "admin".
//
// Se despliega desde el panel de Supabase: Edge Functions → Deploy a new
// function → Via Editor, con el nombre "personal". Luego, en los ajustes de la
// función, desactivar "Verify JWT" (esta función verifica al usuario ella misma).

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ROLES = ['portero', 'consulta', 'admin'];

const responder = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, 'Content-Type': 'application/json' } });

function llaveSecreta(): string {
  const nuevas = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (nuevas) {
    try { const k = JSON.parse(nuevas); if (k.default) return k.default; } catch { /* usa la clásica */ }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return responder({ error: 'Método no permitido.' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, llaveSecreta(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ¿Quién llama? Debe tener sesión y ser administrador.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: sesion } = await admin.auth.getUser(token);
  const yo = sesion?.user;
  if (!yo) return responder({ error: 'Tu sesión venció. Vuelve a entrar.' }, 401);
  const { data: perfil } = await admin.from('staff').select('rol').eq('user_id', yo.id).maybeSingle();
  if (perfil?.rol !== 'admin') return responder({ error: 'Solo un administrador puede gestionar el personal.' }, 403);

  let datos: Record<string, string>;
  try { datos = await req.json(); } catch { return responder({ error: 'Solicitud inválida.' }, 400); }

  if (datos.accion === 'crear') {
    const correo = String(datos.correo ?? '').trim().toLowerCase();
    const nombre = String(datos.nombre ?? '').trim();
    const clave = String(datos.clave ?? '');
    const rol = String(datos.rol ?? '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) return responder({ error: 'El correo no es válido.' }, 400);
    if (nombre.length < 2) return responder({ error: 'Escribe el nombre de la persona.' }, 400);
    if (clave.length < 8) return responder({ error: 'La contraseña debe tener al menos 8 caracteres.' }, 400);
    if (!ROLES.includes(rol)) return responder({ error: 'Rol no válido.' }, 400);

    const { data: creado, error } = await admin.auth.admin.createUser({ email: correo, password: clave, email_confirm: true });
    let userId = creado?.user?.id;
    if (error) {
      // Si la cuenta ya existía (por ejemplo, se le quitó el acceso antes), se reactiva con la nueva contraseña.
      const { data: lista } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existente = lista?.users?.find((u) => (u.email ?? '').toLowerCase() === correo);
      if (!existente) return responder({ error: `No se pudo crear la cuenta: ${error.message}` }, 400);
      userId = existente.id;
      await admin.auth.admin.updateUserById(userId, { password: clave, email_confirm: true });
    }
    const { error: e2 } = await admin.from('staff').upsert({ user_id: userId, nombre, rol });
    if (e2) return responder({ error: `La cuenta se creó, pero no se pudo dar el permiso: ${e2.message}` }, 500);
    return responder({ ok: true, user_id: userId });
  }

  if (datos.accion === 'clave') {
    const clave = String(datos.clave ?? '');
    if (clave.length < 8) return responder({ error: 'La contraseña debe tener al menos 8 caracteres.' }, 400);
    const { error } = await admin.auth.admin.updateUserById(String(datos.user_id), { password: clave });
    if (error) return responder({ error: error.message }, 400);
    return responder({ ok: true });
  }

  if (datos.accion === 'eliminar') {
    if (datos.user_id === yo.id) return responder({ error: 'No puedes quitarte el acceso a ti mismo.' }, 400);
    await admin.from('staff').delete().eq('user_id', datos.user_id);
    const { error } = await admin.auth.admin.deleteUser(String(datos.user_id));
    if (error) return responder({ error: `Se quitó el permiso, pero no se pudo borrar la cuenta: ${error.message}` }, 500);
    return responder({ ok: true });
  }

  return responder({ error: 'Acción no reconocida.' }, 400);
});
