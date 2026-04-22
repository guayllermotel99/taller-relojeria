// ============================================================
// CONFIG
// ============================================================
const CLIENT_ID = '76160976051-deg4u3k5d09jif11pea0gk3qi2cmecpk.apps.googleusercontent.com';
const SHEET_ID  = '1AjeEMxgWksJrcf3qweAQua9frORSzsW8p7s0x_bsEYU';
const SCOPES    = 'https://www.googleapis.com/auth/spreadsheets';

const HEADERS = {
  Clientes:     ['Id_Cliente','Codigo_Cliente','Tipo_Cliente','Nombre_Completo','Nombre_Comercio','Telefono','DNI_CIF','Direccion','Email','Anotaciones','Fecha_Modificacion'],
  Relojes:      ['Id_Reloj','Id_Cliente','Fecha_Alta','Clase','Movimiento','Marca','Modelo','Referencia','Num_Serie','Color_Caja','Material_Correa','Anyo_Aprox','Descripcion'],
  Reparaciones: ['Id_Reparacion','Numero_Reparacion','Id_Reloj','Fecha_Entrada','Descripcion_Problema','Estado_Visual','Observaciones_Internas','Precio_Presupuesto','A_Cuenta','Presupuesto_Aceptado','Estado','Fecha_Entrega_Estimada','Fecha_Entrega_Real','Recoge_Nombre','Recoge_DNI','Sin_Reparar','Motivo_Sin_Reparar','Firma_Base64'],
  Pedidos:      ['Id_Pedido','Id_Cliente','Id_Reloj','Id_Reparacion','Descripcion_Pieza','Referencia_Marca','Proveedor','Precio','Estado','Fecha_Pedido','Fecha_Llegada_Estimada','Fecha_Llegada_Real','Notas'],
  Consultas:    ['Id_Consulta','Id_Cliente','Id_Reloj','Id_Reparacion','Asunto','Descripcion','Respuesta','Estado','Fecha_Consulta']
};

// ============================================================
// ESTADO GLOBAL
// ============================================================
let tokenClient, accessToken;
let clientes = [], relojes = [], reparaciones = [];
let editandoClienteId = null, editandoRelojId = null, editandoReparacionId = null;
let clienteActivoId = null, relojActivoId = null, reparacionActivaId = null;
let reparacionEntregaId = null;
let firmaCtx = null, firmaDibujando = false;
let _sheetIds = null;

// ============================================================
// GOOGLE AUTH — con sesión persistente
// ============================================================
var STORED_EMAIL_KEY = 'taller_user_email';

function cargarGoogleScripts() {
  const s1 = document.createElement('script');
  s1.src = 'https://accounts.google.com/gsi/client';
  s1.onload = initAuth;
  document.head.appendChild(s1);
  const s2 = document.createElement('script');
  s2.src = 'https://apis.google.com/js/api.js';
  s2.onload = () => gapi.load('client', initGapiClient);
  document.head.appendChild(s2);
}

function initAuth() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: async function(resp) {
      if (resp.error) {
        // Si falla el silencioso, mostrar pantalla de login
        document.getElementById('auth-screen').style.display = 'flex';
        document.getElementById('app').style.display = 'none';
        return;
      }
      accessToken = resp.access_token;
      // Guardar email si viene en la respuesta
      if (resp.email) localStorage.setItem(STORED_EMAIL_KEY, resp.email);
      mostrarApp();
      await inicializarHojas();
      await cargarTodo();
    }
  });

  // Intentar login silencioso si ya hubo sesión antes
  var emailGuardado = localStorage.getItem(STORED_EMAIL_KEY);
  if (emailGuardado) {
    // Pedir token sin mostrar pantalla (prompt vacío)
    tokenClient.requestAccessToken({ prompt: '', login_hint: emailGuardado });
  } else {
    // Primera vez: mostrar pantalla de login
    document.getElementById('auth-screen').style.display = 'flex';
  }

  // Renovar token automáticamente cada 50 minutos (caduca a los 60)
  setInterval(function() {
    var email = localStorage.getItem(STORED_EMAIL_KEY);
    if (accessToken && email) {
      tokenClient.requestAccessToken({ prompt: '', login_hint: email });
    }
  }, 50 * 60 * 1000);
}

async function initGapiClient() {
  await gapi.client.init({ discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4'] });
}

function handleSignIn() {
  if (!tokenClient) { toast('Cargando Google...', ''); return; }
  tokenClient.requestAccessToken({ prompt: 'select_account' });
}

function handleSignOut() {
  if (accessToken) google.accounts.oauth2.revoke(accessToken);
  accessToken = null;
  localStorage.removeItem(STORED_EMAIL_KEY);
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

function mostrarApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  // Mostrar email en la cabecera
  var email = localStorage.getItem(STORED_EMAIL_KEY);
  if (email) document.getElementById('user-email').textContent = email;
}

// ============================================================
// SHEETS API
// ============================================================
async function apiGet(range) {
  const r = await fetch(
    'https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID + '/values/' + encodeURIComponent(range),
    { headers: { Authorization: 'Bearer ' + accessToken } }
  );
  const d = await r.json();
  return d.values || [];
}

async function apiAppend(sheet, values) {
  await fetch(
    'https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID + '/values/' + encodeURIComponent(sheet) + '!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
    { method: 'POST', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [values] }) }
  );
}

async function apiUpdate(range, values) {
  await fetch(
    'https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID + '/values/' + encodeURIComponent(range) + '?valueInputOption=RAW',
    { method: 'PUT', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [values] }) }
  );
}

async function apiBatchUpdate(requests) {
  await fetch(
    'https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID + ':batchUpdate',
    { method: 'POST', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ requests: requests }) }
  );
}

async function getSheetIds() {
  if (_sheetIds) return _sheetIds;
  const r = await fetch(
    'https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID + '?fields=sheets.properties',
    { headers: { Authorization: 'Bearer ' + accessToken } }
  );
  const d = await r.json();
  _sheetIds = {};
  for (const s of d.sheets) _sheetIds[s.properties.title] = s.properties.sheetId;
  return _sheetIds;
}

// ============================================================
// INICIALIZAR HOJAS
// ============================================================
async function inicializarHojas() {
  for (const hoja of Object.keys(HEADERS)) {
    const data = await apiGet(hoja + '!A1:A1');
    if (!data.length) await apiUpdate(hoja + '!A1', HEADERS[hoja]);
  }
}

// ============================================================
// CARGAR DATOS
// ============================================================
async function cargarTodo() {
  await Promise.all([cargarClientes(), cargarRelojes(), cargarReparaciones(), cargarPedidos(), cargarConsultas()]);
}

async function cargarClientes() {
  const rows = await apiGet('Clientes!A2:K');
  clientes = rows.map(function(r) { return {
    id: r[0]||'', codigo: r[1]||'', tipo: r[2]||'Particular',
    nombre: r[3]||'', comercio: r[4]||'', telefono: r[5]||'',
    dni: r[6]||'', direccion: r[7]||'', email: r[8]||'',
    anotaciones: r[9]||'', fechaMod: r[10]||''
  }; });
  renderizarListaClientes(clientes);
}

async function cargarRelojes() {
  const rows = await apiGet('Relojes!A2:M');
  relojes = rows.map(function(r) { return {
    id: r[0]||'', idCliente: r[1]||'', fechaAlta: r[2]||'',
    clase: r[3]||'', movimiento: r[4]||'', marca: r[5]||'',
    modelo: r[6]||'', referencia: r[7]||'', serie: r[8]||'',
    colorCaja: r[9]||'', materialCorrea: r[10]||'', anyoAprox: r[11]||'',
    descripcion: r[12]||''
  }; });
  renderizarListaRelojosGlobal(relojes);
}

async function cargarReparaciones() {
  const rows = await apiGet('Reparaciones!A2:R');
  reparaciones = rows.map(function(r) { return {
    id: r[0]||'', numero: r[1]||'', idReloj: r[2]||'', fechaEntrada: r[3]||'',
    problema: r[4]||'', estadoVisual: r[5]||'', observaciones: r[6]||'',
    precio: r[7]||'', aCuenta: r[8]||'', presupuestoAceptado: r[9]||'', estado: r[10]||'',
    fechaEstimada: r[11]||'', fechaEntregaReal: r[12]||'',
    recogeNombre: r[13]||'', recogeDni: r[14]||'',
    sinReparar: r[15]||'', motivoSinReparar: r[16]||'', firma: r[17]||''
  }; });
  renderizarListaReparaciones(reparaciones);
}

// ============================================================
// UTILIDADES
// ============================================================
function uid() { return Math.random().toString(36).substr(2,8); }
function hoy() { return new Date().toLocaleDateString('es-ES'); }
function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }

function codigoCliente(tipo) {
  var pref = tipo === 'Relojero/Tienda' ? 'CLI-REL' : 'CLI-PART';
  return pref + '-' + String(clientes.length + 1).padStart(5,'0');
}

function badgeTipo(tipo) {
  return tipo === 'Relojero/Tienda' ? 'badge-tienda' : 'badge-particular';
}

function badgeEstado(estado) {
  var map = {
    'Pendiente de diagnóstico': 'badge-pendiente',
    'Presupuesto enviado': 'badge-presupuesto',
    'En reparación': 'badge-en-rep',
    'Esperando pieza': 'badge-pieza',
    'Lista para recoger': 'badge-lista',
    'Entregada': 'badge-entregada'
  };
  return map[estado] || 'badge-pendiente';
}

function nombreReloj(r) {
  if (!r) return '—';
  return (r.marca || 'Sin marca') + (r.modelo ? ' · ' + r.modelo : '');
}

// ============================================================
// NAVEGACIÓN
// ============================================================
function showPanel(nombre) {
  document.querySelectorAll('.panel').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.nav-tab').forEach(function(t) { t.classList.remove('active'); });
  var panel = document.getElementById('panel-' + nombre);
  if (panel) panel.classList.add('active');
  event.target.classList.add('active');
}

// ============================================================
// CLIENTES — LISTA
// ============================================================
function renderizarListaClientes(lista) {
  var el = document.getElementById('lista-clientes');
  if (!lista.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👤</div><div class="empty-state-text">No hay clientes. ¡Añade el primero!</div></div>';
    return;
  }
  el.innerHTML = lista.map(function(c) {
    return '<div class="list-item" onclick="verCliente(\'' + c.id + '\')">' +
      '<div class="list-item-main">' +
        '<div class="list-item-name">' + c.nombre + (c.comercio ? ' <span style="color:var(--text3);font-weight:400">· ' + c.comercio + '</span>' : '') + '</div>' +
        '<div class="list-item-sub">' + (c.telefono||'—') + ' · ' + (c.dni||'—') + ' · ' + c.codigo + '</div>' +
      '</div>' +
      '<div class="list-item-actions">' +
        '<span class="badge ' + badgeTipo(c.tipo) + '">' + c.tipo + '</span>' +
        '<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();abrirModalCliente(\'' + c.id + '\')">Editar</button>' +
        '<button class="btn btn-danger btn-sm" onclick="event.stopPropagation();confirmarEliminarCliente(\'' + c.id + '\',\'' + c.nombre.replace(/'/g,"\\'") + '\')">✕</button>' +
      '</div></div>';
  }).join('');
}

function filtrarClientes() {
  var q = document.getElementById('search-clientes').value.toLowerCase();
  renderizarListaClientes(clientes.filter(function(c) {
    return c.nombre.toLowerCase().includes(q) || c.telefono.includes(q) ||
      c.dni.toLowerCase().includes(q) || c.comercio.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
  }));
}

// ============================================================
// CLIENTES — DETALLE
// ============================================================
function verCliente(id) {
  clienteActivoId = id;
  relojActivoId = null;
  var c = clientes.find(function(x) { return x.id === id; });
  if (!c) return;
  var relojesCliente = relojes.filter(function(r) { return r.idCliente === id; });

  document.getElementById('clientes-list-view').style.display = 'none';
  document.getElementById('clientes-detail-view').style.display = 'block';

  var relojesHTML = relojesCliente.length === 0
    ? '<div class="empty-state" style="padding:24px"><div class="empty-state-text">Este cliente no tiene relojes registrados.</div></div>'
    : relojesCliente.map(function(r) { return htmlRelojCard(r, id); }).join('');

  document.getElementById('clientes-detail-view').innerHTML =
    '<div class="breadcrumb">' +
      '<span class="breadcrumb-link" onclick="volverAClientes()">Clientes</span>' +
      '<span class="breadcrumb-sep">›</span>' +
      '<span>' + c.nombre + '</span>' +
    '</div>' +
    '<div class="detail-card">' +
      '<div class="detail-header">' +
        '<div>' +
          '<div class="detail-header-title">' + c.nombre + '</div>' +
          '<div class="detail-header-sub">' + c.codigo + ' · ' + c.tipo + '</div>' +
        '</div>' +
        '<div class="detail-header-actions">' +
          '<button class="btn-header" onclick="abrirModalCliente(\'' + c.id + '\')">✎ Editar</button>' +
        '</div>' +
      '</div>' +
      '<div class="detail-body">' +
        '<div class="detail-grid">' +
          '<div class="detail-field"><div class="detail-field-label">Teléfono</div><div class="detail-field-value mono">' + (c.telefono||'—') + '</div></div>' +
          '<div class="detail-field"><div class="detail-field-label">DNI / CIF</div><div class="detail-field-value mono">' + (c.dni||'—') + '</div></div>' +
          '<div class="detail-field"><div class="detail-field-label">Email</div><div class="detail-field-value">' + (c.email||'—') + '</div></div>' +
          '<div class="detail-field"><div class="detail-field-label">Comercio</div><div class="detail-field-value">' + (c.comercio||'—') + '</div></div>' +
          '<div class="detail-field" style="grid-column:1/-1"><div class="detail-field-label">Dirección</div><div class="detail-field-value">' + (c.direccion||'—') + '</div></div>' +
          (c.anotaciones ? '<div class="detail-field" style="grid-column:1/-1"><div class="detail-field-label">Anotaciones</div><div class="detail-field-value">' + c.anotaciones + '</div></div>' : '') +
        '</div>' +
        '<div class="subsection-title">Relojes <small style="font-size:14px;font-weight:400;color:var(--text3)">(' + relojesCliente.length + ')</small>' +
          '<button class="btn btn-primary btn-sm" onclick="abrirModalReloj(\'' + id + '\')">+ Añadir reloj</button>' +
        '</div>' +
        '<div id="relojes-cliente-' + id + '">' + relojesHTML + '</div>' +
      '</div>' +
    '</div>';
}

function htmlRelojCard(r, idCliente) {
  var activa = reparaciones.find(function(x) { return x.idReloj === r.id && x.estado !== 'Entregada'; });
  return '<div class="reloj-card" onclick="verReloj(\'' + r.id + '\')">' +
    '<div class="reloj-card-main">' +
      '<div class="reloj-card-marca">' + (r.marca||'Sin marca') + (r.modelo ? ' · ' + r.modelo : '') + '</div>' +
      '<div class="reloj-card-modelo">' + r.movimiento + ' · ' + r.clase + '</div>' +
      (r.serie ? '<div class="reloj-card-ref">N/S: ' + r.serie + '</div>' : '') +
      (r.referencia ? '<div class="reloj-card-ref">Ref: ' + r.referencia + '</div>' : '') +
      (activa ? '<div style="margin-top:6px"><span class="badge ' + badgeEstado(activa.estado) + '">' + activa.estado + '</span></div>' : '') +
    '</div>' +
    '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">' +
      '<span class="reloj-clase-badge">' + r.clase + '</span>' +
      '<div style="display:flex;gap:6px">' +
        '<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();abrirModalReloj(\'' + idCliente + '\',\'' + r.id + '\')">Editar</button>' +
        '<button class="btn btn-danger btn-sm" onclick="event.stopPropagation();confirmarEliminarReloj(\'' + r.id + '\',\'' + (r.marca||'').replace(/'/g,"\\'") + '\')">✕</button>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function volverAClientes() {
  clienteActivoId = null;
  relojActivoId = null;
  document.getElementById('clientes-list-view').style.display = 'block';
  document.getElementById('clientes-detail-view').style.display = 'none';
}

// ============================================================
// RELOJES — DETALLE (funciona desde panel Clientes y panel Relojes)
// ============================================================
// desdePanel: 'clientes' | 'relojes'
var relojDesdePanel = 'clientes';

function verReloj(id, desdePanel) {
  relojActivoId = id;
  relojDesdePanel = desdePanel || (clienteActivoId ? 'clientes' : 'relojes');

  var r = relojes.find(function(x) { return x.id === id; });
  if (!r) return;
  var c = clientes.find(function(x) { return x.id === r.idCliente; });
  var repsReloj = reparaciones.filter(function(x) { return x.idReloj === id; });

  // Decidir en qué contenedor renderizamos
  var dv;
  if (relojDesdePanel === 'relojes') {
    document.getElementById('relojes-list-view').style.display = 'none';
    dv = document.getElementById('relojes-detail-view');
    dv.style.display = 'block';
  } else {
    document.getElementById('clientes-list-view').style.display = 'none';
    dv = document.getElementById('clientes-detail-view');
    dv.style.display = 'block';
  }

  // Breadcrumb adaptado al panel de origen
  var breadcrumb;
  if (relojDesdePanel === 'relojes') {
    breadcrumb =
      '<span class="breadcrumb-link" onclick="volverARelojes()">Relojes</span>' +
      '<span class="breadcrumb-sep">›</span>' +
      (c ? '<span style="color:var(--text3)">' + c.nombre + '</span><span class="breadcrumb-sep">›</span>' : '') +
      '<span>' + nombreReloj(r) + '</span>';
  } else {
    breadcrumb =
      '<span class="breadcrumb-link" onclick="volverAClientes()">Clientes</span>' +
      '<span class="breadcrumb-sep">›</span>' +
      (c ? '<span class="breadcrumb-link" onclick="verCliente(\'' + c.id + '\')">' + c.nombre + '</span><span class="breadcrumb-sep">›</span>' : '') +
      '<span>' + nombreReloj(r) + '</span>';
  }

  var repsHTML = repsReloj.length === 0
    ? '<div class="empty-state" style="padding:24px"><div class="empty-state-text">Este reloj no tiene reparaciones registradas.</div></div>'
    : repsReloj.map(function(rep) {
        return '<div class="rep-card" onclick="verReparacion(\'' + rep.id + '\')">' +
          '<div class="rep-card-header">' +
            '<div>' +
              '<div class="rep-card-title">' + (rep.numero ? '<span style="font-family:var(--font-mono);font-size:12px;color:var(--text3);margin-right:6px">' + rep.numero + '</span>' : '') + (rep.problema||'Sin descripción').substring(0,70) + (rep.problema&&rep.problema.length>70?'...':'') + '</div>' +
              '<div class="rep-card-sub">Entrada: ' + rep.fechaEntrada + (rep.fechaEstimada?' · Estimada: '+rep.fechaEstimada:'') + '</div>' +
            '</div>' +
            '<div class="rep-card-actions">' +
              '<span class="badge ' + badgeEstado(rep.estado) + '">' + rep.estado + '</span>' +
              (rep.estado==='Lista para recoger' ? '<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();abrirModalEntrega(\'' + rep.id + '\')">Entregar</button>' : '') +
              '<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();abrirModalReparacion(null,\'' + rep.id + '\')">Editar</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('');

  dv.innerHTML =
    '<div class="breadcrumb">' + breadcrumb + '</div>' +
    '<div class="detail-card">' +
      '<div class="detail-header">' +
        '<div>' +
          '<div class="detail-header-title">' + nombreReloj(r) + '</div>' +
          '<div class="detail-header-sub">' + r.clase + ' · ' + r.movimiento + (c?' · '+c.nombre:'') + '</div>' +
        '</div>' +
        '<div class="detail-header-actions">' +
          '<button class="btn-header" onclick="abrirModalReparacion(\'' + r.id + '\',null)">+ Reparación</button>' +
          '<button class="btn-header" onclick="abrirModalReloj(\'' + r.idCliente + '\',\'' + r.id + '\')">✎ Editar</button>' +
        '</div>' +
      '</div>' +
      '<div class="detail-body">' +
        '<div class="detail-grid">' +
          '<div class="detail-field"><div class="detail-field-label">Marca</div><div class="detail-field-value">' + (r.marca||'—') + '</div></div>' +
          '<div class="detail-field"><div class="detail-field-label">Modelo</div><div class="detail-field-value">' + (r.modelo||'—') + '</div></div>' +
          '<div class="detail-field"><div class="detail-field-label">Referencia</div><div class="detail-field-value mono">' + (r.referencia||'—') + '</div></div>' +
          '<div class="detail-field"><div class="detail-field-label">Número de serie</div><div class="detail-field-value mono">' + (r.serie||'—') + '</div></div>' +
          '<div class="detail-field"><div class="detail-field-label">Movimiento</div><div class="detail-field-value">' + (r.movimiento||'—') + '</div></div>' +
          '<div class="detail-field"><div class="detail-field-label">Clase</div><div class="detail-field-value">' + (r.clase||'—') + '</div></div>' +
          '<div class="detail-field"><div class="detail-field-label">Color de caja</div><div class="detail-field-value">' + (r.colorCaja||'—') + '</div></div>' +
          '<div class="detail-field"><div class="detail-field-label">Material correa</div><div class="detail-field-value">' + (r.materialCorrea||'—') + '</div></div>' +
          '<div class="detail-field"><div class="detail-field-label">Año aprox.</div><div class="detail-field-value">' + (r.anyoAprox||'—') + '</div></div>' +
          '<div class="detail-field"><div class="detail-field-label">Fecha de alta</div><div class="detail-field-value mono">' + (r.fechaAlta||'—') + '</div></div>' +
          (r.descripcion ? '<div class="detail-field" style="grid-column:1/-1"><div class="detail-field-label">Descripción</div><div class="detail-field-value">' + r.descripcion + '</div></div>' : '') +
        '</div>' +
        '<div class="subsection-title">Reparaciones <small style="font-size:14px;font-weight:400;color:var(--text3)">(' + repsReloj.length + ')</small>' +
          '<button class="btn btn-primary btn-sm" onclick="abrirModalReparacion(\'' + r.id + '\',null)">+ Nueva reparación</button>' +
        '</div>' +
        repsHTML +
      '</div>' +
    '</div>';
}

function volverARelojes() {
  relojActivoId = null;
  document.getElementById('relojes-list-view').style.display = 'block';
  document.getElementById('relojes-detail-view').style.display = 'none';
}

// ============================================================
// CLIENTES — MODAL
// ============================================================
function abrirModalCliente(id) {
  id = id || null;
  editandoClienteId = id;
  var c = id ? clientes.find(function(x) { return x.id === id; }) : null;
  document.getElementById('modal-cliente-title').textContent = c ? 'Editar cliente' : 'Nuevo cliente';
  document.getElementById('c-tipo').value        = c ? c.tipo : 'Particular';
  document.getElementById('c-nombre').value      = c ? c.nombre : '';
  document.getElementById('c-comercio').value    = c ? c.comercio : '';
  document.getElementById('c-telefono').value    = c ? c.telefono : '';
  document.getElementById('c-dni').value         = c ? c.dni : '';
  document.getElementById('c-email').value       = c ? c.email : '';
  document.getElementById('c-direccion').value   = c ? c.direccion : '';
  document.getElementById('c-anotaciones').value = c ? c.anotaciones : '';
  abrirModal('modal-cliente');
}

async function guardarCliente() {
  var nombre = val('c-nombre');
  if (!nombre) { toast('El nombre es obligatorio', 'error'); return; }
  var tipo = val('c-tipo'), comercio = val('c-comercio'), telefono = val('c-telefono');
  var dni = val('c-dni'), email = val('c-email'), direccion = val('c-direccion');
  var anots = val('c-anotaciones'), fecha = hoy();
  if (editandoClienteId) {
    var idx = clientes.findIndex(function(c) { return c.id === editandoClienteId; });
    var codigo = clientes[idx].codigo;
    await apiUpdate('Clientes!A' + (idx+2) + ':K' + (idx+2), [editandoClienteId, codigo, tipo, nombre, comercio, telefono, dni, direccion, email, anots, fecha]);
    clientes[idx] = { id: editandoClienteId, codigo: codigo, tipo: tipo, nombre: nombre, comercio: comercio, telefono: telefono, dni: dni, direccion: direccion, email: email, anotaciones: anots, fechaMod: fecha };
    toast('Cliente actualizado', 'success');
  } else {
    var id = uid(), codigoN = codigoCliente(tipo);
    await apiAppend('Clientes', [id, codigoN, tipo, nombre, comercio, telefono, dni, direccion, email, anots, fecha]);
    clientes.push({ id: id, codigo: codigoN, tipo: tipo, nombre: nombre, comercio: comercio, telefono: telefono, dni: dni, direccion: direccion, email: email, anotaciones: anots, fechaMod: fecha });
    toast('Cliente creado', 'success');
  }
  cerrarModal('modal-cliente');
  renderizarListaClientes(clientes);
  if (editandoClienteId && clienteActivoId === editandoClienteId) verCliente(editandoClienteId);
}

// ============================================================
// RELOJES — LISTA GLOBAL
// ============================================================
function renderizarListaRelojosGlobal(lista) {
  var el = document.getElementById('lista-relojes-global');
  if (!lista.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⌚</div><div class="empty-state-text">No hay relojes registrados.</div></div>';
    return;
  }
  el.innerHTML = lista.map(function(r) {
    var c = clientes.find(function(x) { return x.id === r.idCliente; });
    return '<div class="list-item" onclick="verReloj(\'' + r.id + '\',\'relojes\')">' +
      '<div class="list-item-main">' +
        '<div class="list-item-name">' + nombreReloj(r) + '</div>' +
        '<div class="list-item-sub">' + r.clase + ' · ' + r.movimiento + (r.serie?' · N/S: '+r.serie:'') + (c?' — '+c.nombre:'') + '</div>' +
      '</div>' +
      '<div class="list-item-actions">' +
        '<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();abrirModalReloj(\'' + r.idCliente + '\',\'' + r.id + '\')">Editar</button>' +
        '<button class="btn btn-danger btn-sm" onclick="event.stopPropagation();confirmarEliminarReloj(\'' + r.id + '\',\'' + (r.marca||'').replace(/'/g,"\\'") + '\')">✕</button>' +
      '</div></div>';
  }).join('');
}

function filtrarRelojes() {
  var q = document.getElementById('search-relojes').value.toLowerCase();
  renderizarListaRelojosGlobal(relojes.filter(function(r) {
    return r.marca.toLowerCase().includes(q) || r.modelo.toLowerCase().includes(q) ||
      r.referencia.toLowerCase().includes(q) || r.serie.toLowerCase().includes(q);
  }));
}

// ============================================================
// RELOJES — MODAL
// ============================================================
function abrirModalReloj(idCliente, idReloj) {
  idCliente = idCliente || null;
  idReloj = idReloj || null;
  editandoRelojId = idReloj;
  var r = idReloj ? relojes.find(function(x) { return x.id === idReloj; }) : null;
  document.getElementById('modal-reloj-title').textContent = r ? 'Editar reloj' : 'Nuevo reloj';
  var selectorCliente = document.getElementById('reloj-cliente-selector');
  var selectCliente = document.getElementById('r-cliente');
  if (!idCliente) {
    selectorCliente.style.display = 'block';
    selectCliente.innerHTML = clientes.map(function(c) { return '<option value="' + c.id + '" ' + (r&&r.idCliente===c.id?'selected':'') + '>' + c.nombre + '</option>'; }).join('');
  } else {
    selectorCliente.style.display = 'none';
    selectCliente.dataset.fijo = idCliente;
  }
  document.getElementById('r-clase').value       = r ? r.clase : 'Pulsera';
  document.getElementById('r-movimiento').value  = r ? r.movimiento : 'Cuarzo';
  document.getElementById('r-marca').value       = r ? r.marca : '';
  document.getElementById('r-modelo').value      = r ? r.modelo : '';
  document.getElementById('r-referencia').value  = r ? r.referencia : '';
  document.getElementById('r-serie').value       = r ? r.serie : '';
  document.getElementById('r-color').value       = r ? r.colorCaja : '';
  document.getElementById('r-correa').value      = r ? r.materialCorrea : '';
  document.getElementById('r-anyo').value        = r ? r.anyoAprox : '';
  document.getElementById('r-descripcion').value = r ? r.descripcion : '';
  abrirModal('modal-reloj');
}

async function guardarReloj() {
  var selectorCliente = document.getElementById('reloj-cliente-selector');
  var selectCliente = document.getElementById('r-cliente');
  var idCliente = selectorCliente.style.display === 'none' ? selectCliente.dataset.fijo : selectCliente.value;
  if (!idCliente) { toast('Selecciona un cliente', 'error'); return; }
  var clase = val('r-clase'), movimiento = val('r-movimiento'), marca = val('r-marca');
  var modelo = val('r-modelo'), referencia = val('r-referencia'), serie = val('r-serie');
  var colorCaja = val('r-color'), correa = val('r-correa'), anyo = val('r-anyo');
  var desc = val('r-descripcion'), fecha = hoy();
  if (editandoRelojId) {
    var idx = relojes.findIndex(function(r) { return r.id === editandoRelojId; });
    await apiUpdate('Relojes!A' + (idx+2) + ':M' + (idx+2), [editandoRelojId, idCliente, fecha, clase, movimiento, marca, modelo, referencia, serie, colorCaja, correa, anyo, desc]);
    relojes[idx] = { id: editandoRelojId, idCliente: idCliente, fechaAlta: fecha, clase: clase, movimiento: movimiento, marca: marca, modelo: modelo, referencia: referencia, serie: serie, colorCaja: colorCaja, materialCorrea: correa, anyoAprox: anyo, descripcion: desc };
    toast('Reloj actualizado', 'success');
  } else {
    var id = uid();
    await apiAppend('Relojes', [id, idCliente, fecha, clase, movimiento, marca, modelo, referencia, serie, colorCaja, correa, anyo, desc]);
    relojes.push({ id: id, idCliente: idCliente, fechaAlta: fecha, clase: clase, movimiento: movimiento, marca: marca, modelo: modelo, referencia: referencia, serie: serie, colorCaja: colorCaja, materialCorrea: correa, anyoAprox: anyo, descripcion: desc });
    toast('Reloj añadido', 'success');
  }
  cerrarModal('modal-reloj');
  renderizarListaRelojosGlobal(relojes);
  if (clienteActivoId) verCliente(clienteActivoId);
  if (relojActivoId) verReloj(relojActivoId);
}

// ============================================================
// REPARACIONES — LISTA
// ============================================================
function renderizarListaReparaciones(lista) {
  var el = document.getElementById('lista-reparaciones');
  if (!lista.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔧</div><div class="empty-state-text">No hay reparaciones. ¡Añade la primera!</div></div>';
    return;
  }
  el.innerHTML = lista.map(function(rep) {
    var reloj = relojes.find(function(r) { return r.id === rep.idReloj; });
    var cliente = reloj ? clientes.find(function(c) { return c.id === reloj.idCliente; }) : null;
    return '<div class="list-item" onclick="verReparacion(\'' + rep.id + '\')">' +
      '<div class="list-item-main">' +
        '<div class="list-item-name">' + (rep.numero ? '<span style="font-family:var(--font-mono);font-size:13px;color:var(--text3);margin-right:8px">' + rep.numero + '</span>' : '') + (cliente?cliente.nombre:'—') + ' — ' + nombreReloj(reloj) + '</div>' +
        '<div class="list-item-sub">' + (rep.problema||'Sin descripción').substring(0,60) + (rep.problema&&rep.problema.length>60?'...':'') + '</div>' +
        '<div class="list-item-sub" style="margin-top:3px">' + rep.fechaEntrada + (rep.fechaEstimada?' · Estimada: '+rep.fechaEstimada:'') + '</div>' +
      '</div>' +
      '<div class="list-item-actions">' +
        '<span class="badge ' + badgeEstado(rep.estado) + '">' + rep.estado + '</span>' +
        (rep.estado==='Lista para recoger' ? '<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();abrirModalEntrega(\'' + rep.id + '\')">Entregar</button>' : '') +
        '<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();abrirModalReparacion(null,\'' + rep.id + '\')">Editar</button>' +
        '<button class="btn btn-danger btn-sm" onclick="event.stopPropagation();confirmarEliminarReparacion(\'' + rep.id + '\')">✕</button>' +
      '</div></div>';
  }).join('');
}

function filtrarReparaciones() {
  var q = document.getElementById('search-reparaciones').value.toLowerCase();
  var st = document.getElementById('filtro-estado-rep').value;
  renderizarListaReparaciones(reparaciones.filter(function(rep) {
    var reloj = relojes.find(function(r) { return r.id === rep.idReloj; });
    var cliente = reloj ? clientes.find(function(c) { return c.id === reloj.idCliente; }) : null;
    var texto = [(cliente?cliente.nombre:''), (reloj?reloj.marca:''), (reloj?reloj.modelo:''), rep.problema].join(' ').toLowerCase();
    return texto.includes(q) && (!st || rep.estado === st);
  }));
}

// ============================================================
// REPARACIONES — DETALLE
// ============================================================
function verReparacion(id) {
  reparacionActivaId = id;
  var rep = reparaciones.find(function(x) { return x.id === id; });
  if (!rep) return;
  var reloj = relojes.find(function(r) { return r.id === rep.idReloj; });
  var cliente = reloj ? clientes.find(function(c) { return c.id === reloj.idCliente; }) : null;

  document.getElementById('reparaciones-list-view').style.display = 'none';
  document.getElementById('reparaciones-detail-view').style.display = 'block';

  var entregaHTML = rep.estado === 'Entregada' ?
    '<div class="detail-field"><div class="detail-field-label">Fecha de entrega real</div><div class="detail-field-value mono">' + (rep.fechaEntregaReal||'—') + '</div></div>' +
    '<div class="detail-field"><div class="detail-field-label">Recogido por</div><div class="detail-field-value">' + (rep.recogeNombre||'—') + (rep.recogeDni?' ('+rep.recogeDni+')':'') + '</div></div>' +
    (rep.sinReparar==='Sí' ? '<div class="detail-field" style="grid-column:1/-1"><div class="detail-field-label">Entregado sin reparar</div><div class="detail-field-value" style="color:var(--danger)">' + (rep.motivoSinReparar||'Sí') + '</div></div>' : '') +
    (rep.firma ? '<div class="detail-field" style="grid-column:1/-1"><div class="detail-field-label">Firma</div><img src="' + rep.firma + '" style="max-width:280px;border:1px solid var(--border);border-radius:var(--radius);background:white;padding:4px"></div>' : '')
    : '';

  document.getElementById('reparaciones-detail-view').innerHTML =
    '<div class="breadcrumb">' +
      '<span class="breadcrumb-link" onclick="volverAReparaciones()">Reparaciones</span>' +
      '<span class="breadcrumb-sep">›</span>' +
      '<span>' + (cliente?cliente.nombre:'—') + ' — ' + nombreReloj(reloj) + '</span>' +
    '</div>' +
    '<div class="detail-card">' +
      '<div class="detail-header">' +
        '<div>' +
          '<div class="detail-header-title">' + nombreReloj(reloj) + '</div>' +
          '<div class="detail-header-sub">' + (cliente?cliente.nombre:'—') + ' · ' + (rep.numero||rep.id) + ' · Entrada: ' + rep.fechaEntrada + '</div>' +
        '</div>' +
        '<div class="detail-header-actions">' +
          '<button class="btn-header" onclick="imprimirResguardoEntrada(\'' + rep.id + '\')">🖨 Resguardo</button>' +
          (rep.estado==='Entregada' ? '<button class="btn-header" onclick="imprimirTicketEntrega(\'' + rep.id + '\')">🖨 Entrega</button>' : '') +
          (rep.estado==='Lista para recoger' ? '<button class="btn-header" onclick="abrirModalEntrega(\'' + rep.id + '\')">📋 Entregar</button>' : '') +
          '<button class="btn-header" onclick="abrirModalReparacion(null,\'' + rep.id + '\')">✎ Editar</button>' +
        '</div>' +
      '</div>' +
      '<div class="detail-body">' +
        '<div style="margin-bottom:16px">' +
          '<span class="badge ' + badgeEstado(rep.estado) + '" style="font-size:13px;padding:5px 14px">' + rep.estado + '</span>' +
          (rep.presupuestoAceptado ? '<span class="badge" style="margin-left:8px;background:var(--bg2);color:var(--text2)">Presupuesto: ' + rep.presupuestoAceptado + '</span>' : '') +
        '</div>' +
        '<div class="detail-grid">' +
          '<div class="detail-field" style="grid-column:1/-1"><div class="detail-field-label">Descripción del problema</div><div class="detail-field-value">' + (rep.problema||'—') + '</div></div>' +
          (rep.estadoVisual ? '<div class="detail-field" style="grid-column:1/-1"><div class="detail-field-label">Estado visual al entrar</div><div class="detail-field-value">' + rep.estadoVisual + '</div></div>' : '') +
          (rep.observaciones ? '<div class="detail-field" style="grid-column:1/-1"><div class="detail-field-label">Observaciones internas</div><div class="detail-field-value" style="color:var(--text2);font-style:italic">' + rep.observaciones + '</div></div>' : '') +
          '<div class="detail-field"><div class="detail-field-label">Precio total</div><div class="detail-field-value mono">' + (rep.precio?rep.precio+' €':'—') + '</div></div>' +
          '<div class="detail-field"><div class="detail-field-label">A cuenta</div><div class="detail-field-value mono">' + (rep.aCuenta?rep.aCuenta+' €':'—') + '</div></div>' +
          (rep.precio && rep.aCuenta ? '<div class="detail-field"><div class="detail-field-label">Restan</div><div class="detail-field-value mono" style="color:var(--warning)">' + (parseFloat(rep.precio) - parseFloat(rep.aCuenta)).toFixed(2) + ' €</div></div>' : '') +
          '<div class="detail-field"><div class="detail-field-label">Entrega estimada</div><div class="detail-field-value mono">' + (rep.fechaEstimada||'—') + '</div></div>' +
          entregaHTML +
        '</div>' +
        (reloj ? '<div class="subsection-title" style="margin-top:8px">Reloj</div>' +
          '<div class="reloj-card" onclick="verReloj(\'' + reloj.id + '\')">' +
            '<div class="reloj-card-main">' +
              '<div class="reloj-card-marca">' + nombreReloj(reloj) + '</div>' +
              '<div class="reloj-card-modelo">' + reloj.movimiento + ' · ' + reloj.clase + '</div>' +
              (reloj.serie ? '<div class="reloj-card-ref">N/S: ' + reloj.serie + '</div>' : '') +
            '</div>' +
            '<span class="reloj-clase-badge">' + reloj.clase + '</span>' +
          '</div>' : '') +
      '</div>' +
    '</div>';
}

function volverAReparaciones() {
  reparacionActivaId = null;
  document.getElementById('reparaciones-list-view').style.display = 'block';
  document.getElementById('reparaciones-detail-view').style.display = 'none';
}

// ============================================================
// REPARACIONES — MODAL CON CREACIÓN RÁPIDA
// ============================================================
function abrirModalReparacion(idRelojFijo, idReparacion) {
  idRelojFijo = idRelojFijo || null;
  idReparacion = idReparacion || null;
  editandoReparacionId = idReparacion;
  var rep = idReparacion ? reparaciones.find(function(x) { return x.id === idReparacion; }) : null;
  document.getElementById('modal-reparacion-title').textContent = rep ? 'Editar reparación' : 'Nueva reparación';

  ocultarCreacionRapidaCliente();
  ocultarCreacionRapidaReloj();
  limpiarClienteSeleccionado();

  // Si editamos, preseleccionar cliente y reloj
  if (rep) {
    var relojRep = relojes.find(function(r) { return r.id === rep.idReloj; });
    if (relojRep) {
      var clienteRep = clientes.find(function(c) { return c.id === relojRep.idCliente; });
      if (clienteRep) seleccionarClienteModal(clienteRep.id, clienteRep.nombre);
      actualizarRelojesSelect(rep.idReloj);
    }
  } else if (idRelojFijo) {
    var relojFijo = relojes.find(function(r) { return r.id === idRelojFijo; });
    if (relojFijo) {
      var clienteFijo = clientes.find(function(c) { return c.id === relojFijo.idCliente; });
      if (clienteFijo) seleccionarClienteModal(clienteFijo.id, clienteFijo.nombre);
      actualizarRelojesSelect(idRelojFijo);
    }
  } else {
    actualizarRelojesSelect(null);
  }

  document.getElementById('rep-problema').value             = rep ? rep.problema : '';
  document.getElementById('rep-estado-visual').value        = rep ? rep.estadoVisual : '';
  document.getElementById('rep-observaciones').value        = rep ? rep.observaciones : '';
  document.getElementById('rep-precio').value               = rep ? rep.precio : '';
  document.getElementById('rep-acuenta').value              = rep ? rep.aCuenta : '';
  document.getElementById('rep-presupuesto-aceptado').value = rep ? rep.presupuestoAceptado : '';
  document.getElementById('rep-estado').value               = rep ? rep.estado : 'Pendiente de diagnóstico';
  document.getElementById('rep-fecha-estimada').value       = rep ? rep.fechaEstimada : '';

  abrirModal('modal-reparacion');
}

// Buscador de cliente en modal reparación
function filtrarClientesModal() {
  var q = document.getElementById('rep-cliente-search').value.toLowerCase().trim();
  var dropdown = document.getElementById('rep-cliente-dropdown');
  if (!q) { dropdown.style.display = 'none'; return; }
  var filtrados = clientes.filter(function(c) {
    return c.nombre.toLowerCase().includes(q) || c.telefono.includes(q) || c.dni.toLowerCase().includes(q);
  }).slice(0, 8);
  if (!filtrados.length) {
    dropdown.innerHTML = '<div style="padding:10px 14px;font-size:13px;color:var(--text3)">Sin resultados</div>';
  } else {
    dropdown.innerHTML = filtrados.map(function(c) {
      return '<div onclick="seleccionarClienteModal(\'' + c.id + '\',\'' + c.nombre.replace(/'/g,"\\'") + '\')" style="padding:10px 14px;cursor:pointer;font-size:14px;border-bottom:1px solid var(--border)" onmouseover="this.style.background=\'var(--bg2)\'" onmouseout="this.style.background=\'\'">' +
        '<div style="font-weight:500">' + c.nombre + '</div>' +
        '<div style="font-size:12px;color:var(--text3);font-family:var(--font-mono)">' + (c.telefono||'') + (c.dni?' · '+c.dni:'') + '</div>' +
      '</div>';
    }).join('');
  }
  dropdown.style.display = 'block';
}

function seleccionarClienteModal(id, nombre) {
  document.getElementById('rep-cliente').value = id;
  document.getElementById('rep-cliente-search').value = '';
  document.getElementById('rep-cliente-dropdown').style.display = 'none';
  var pill = document.getElementById('rep-cliente-seleccionado');
  pill.style.display = 'flex';
  document.getElementById('rep-cliente-seleccionado-nombre').textContent = nombre;
  actualizarRelojesSelect(null);
}

function limpiarClienteSeleccionado() {
  document.getElementById('rep-cliente').value = '';
  document.getElementById('rep-cliente-search').value = '';
  document.getElementById('rep-cliente-dropdown').style.display = 'none';
  var pill = document.getElementById('rep-cliente-seleccionado');
  if (pill) pill.style.display = 'none';
  actualizarRelojesSelect(null);
}

function actualizarRelojesSelect(idRelojSeleccionado) {
  var idCliente = document.getElementById('rep-cliente').value;
  var relojesCliente = relojes.filter(function(r) { return r.idCliente === idCliente; });
  var sel = document.getElementById('rep-reloj');
  if (!relojesCliente.length) {
    sel.innerHTML = '<option value="">— Sin relojes registrados —</option>';
  } else {
    sel.innerHTML = relojesCliente.map(function(r) {
      return '<option value="' + r.id + '" ' + (r.id===idRelojSeleccionado?'selected':'') + '>' + nombreReloj(r) + '</option>';
    }).join('');
  }
  ocultarCreacionRapidaReloj();
}

// Creación rápida — Cliente
function mostrarCreacionRapidaCliente() {
  document.getElementById('rep-nuevo-cliente-panel').style.display = 'block';
  document.getElementById('rep-nc-nombre').focus();
}

function ocultarCreacionRapidaCliente() {
  var p = document.getElementById('rep-nuevo-cliente-panel');
  if (p) {
    p.style.display = 'none';
    p.querySelectorAll('input').forEach(function(i) { i.value = ''; });
  }
}

async function guardarClienteRapido() {
  var nombre   = document.getElementById('rep-nc-nombre').value.trim();
  var telefono = document.getElementById('rep-nc-telefono').value.trim();
  var dni      = document.getElementById('rep-nc-dni').value.trim();
  if (!nombre) { toast('El nombre es obligatorio', 'error'); return; }
  var id = uid(), codigo = codigoCliente('Particular'), fecha = hoy();
  await apiAppend('Clientes', [id, codigo, 'Particular', nombre, '', telefono, dni, '', '', '', fecha]);
  clientes.push({ id: id, codigo: codigo, tipo: 'Particular', nombre: nombre, comercio: '', telefono: telefono, dni: dni, direccion: '', email: '', anotaciones: '', fechaMod: fecha });
  seleccionarClienteModal(id, nombre);
  ocultarCreacionRapidaCliente();
  renderizarListaClientes(clientes);
  toast('Cliente "' + nombre + '" creado', 'success');
}

// Creación rápida — Reloj
function mostrarCreacionRapidaReloj() {
  var idCliente = document.getElementById('rep-cliente').value;
  if (!idCliente) { toast('Primero selecciona o crea un cliente', 'error'); return; }
  document.getElementById('rep-nuevo-reloj-panel').style.display = 'block';
  document.getElementById('rep-nr-marca').focus();
}

function ocultarCreacionRapidaReloj() {
  var p = document.getElementById('rep-nuevo-reloj-panel');
  if (p) {
    p.style.display = 'none';
    p.querySelectorAll('input').forEach(function(i) { i.value = ''; });
    p.querySelectorAll('select').forEach(function(s) { s.selectedIndex = 0; });
  }
}

async function guardarRelojRapido() {
  var idCliente = document.getElementById('rep-cliente').value;
  if (!idCliente) { toast('Selecciona un cliente', 'error'); return; }
  var marca  = document.getElementById('rep-nr-marca').value.trim();
  var modelo = document.getElementById('rep-nr-modelo').value.trim();
  var clase  = document.getElementById('rep-nr-clase').value;
  var mov    = document.getElementById('rep-nr-movimiento').value;
  var serie  = document.getElementById('rep-nr-serie').value.trim();
  var fecha  = hoy(), id = uid();
  await apiAppend('Relojes', [id, idCliente, fecha, clase, mov, marca, modelo, '', serie, '', '', '', '']);
  relojes.push({ id: id, idCliente: idCliente, fechaAlta: fecha, clase: clase, movimiento: mov, marca: marca, modelo: modelo, referencia: '', serie: serie, colorCaja: '', materialCorrea: '', anyoAprox: '', descripcion: '' });
  actualizarRelojesSelect(id);
  ocultarCreacionRapidaReloj();
  renderizarListaRelojosGlobal(relojes);
  toast('Reloj "' + (marca||'nuevo') + '" creado', 'success');
}

function siguienteNumeroReparacion() {
  var base = 70000;
  if (!reparaciones.length) return 'REP-' + String(base + 1).padStart(6,'0');
  var nums = reparaciones.map(function(r) {
    var n = parseInt((r.numero||'').replace('REP-',''), 10);
    return isNaN(n) ? 0 : n;
  });
  var max = Math.max.apply(null, nums);
  return 'REP-' + String(Math.max(max, base) + 1).padStart(6,'0');
}

async function guardarReparacion() {
  var idReloj  = document.getElementById('rep-reloj').value;
  var problema = val('rep-problema');
  if (!idReloj)  { toast('Selecciona un reloj', 'error'); return; }
  if (!problema) { toast('La descripción del problema es obligatoria', 'error'); return; }
  var estadoVisual = val('rep-estado-visual'), observaciones = val('rep-observaciones');
  var precio = val('rep-precio'), aCuenta = val('rep-acuenta');
  var presupAceptado = val('rep-presupuesto-aceptado');
  var estado = val('rep-estado'), fechaEstimada = val('rep-fecha-estimada');
  var fechaEntrada = editandoReparacionId ? reparaciones.find(function(r){ return r.id===editandoReparacionId; }).fechaEntrada : hoy();
  if (editandoReparacionId) {
    var idx = reparaciones.findIndex(function(r) { return r.id === editandoReparacionId; });
    var rep = reparaciones[idx];
    await apiUpdate('Reparaciones!A' + (idx+2) + ':L' + (idx+2), [editandoReparacionId, rep.numero, idReloj, fechaEntrada, problema, estadoVisual, observaciones, precio, aCuenta, presupAceptado, estado, fechaEstimada]);
    reparaciones[idx] = Object.assign({}, rep, { idReloj: idReloj, problema: problema, estadoVisual: estadoVisual, observaciones: observaciones, precio: precio, aCuenta: aCuenta, presupuestoAceptado: presupAceptado, estado: estado, fechaEstimada: fechaEstimada });
    toast('Reparación actualizada', 'success');
  } else {
    var newId = uid();
    var numero = siguienteNumeroReparacion();
    await apiAppend('Reparaciones', [newId, numero, idReloj, fechaEntrada, problema, estadoVisual, observaciones, precio, aCuenta, presupAceptado, estado, fechaEstimada, '', '', '', '', '', '']);
    reparaciones.push({ id: newId, numero: numero, idReloj: idReloj, fechaEntrada: fechaEntrada, problema: problema, estadoVisual: estadoVisual, observaciones: observaciones, precio: precio, aCuenta: aCuenta, presupuestoAceptado: presupAceptado, estado: estado, fechaEstimada: fechaEstimada, fechaEntregaReal: '', recogeNombre: '', recogeDni: '', sinReparar: '', motivoSinReparar: '', firma: '' });
    toast('Reparación ' + numero + ' creada', 'success');
  }
  cerrarModal('modal-reparacion');
  renderizarListaReparaciones(reparaciones);
  if (relojActivoId) verReloj(relojActivoId, relojDesdePanel);
  if (reparacionActivaId && reparacionActivaId === editandoReparacionId) verReparacion(editandoReparacionId);
}

// ============================================================
// ENTREGA CON FIRMA
// ============================================================
function abrirModalEntrega(idReparacion) {
  reparacionEntregaId = idReparacion;
  document.getElementById('ent-fecha').value         = new Date().toISOString().split('T')[0];
  document.getElementById('ent-sin-reparar').value   = 'No';
  document.getElementById('ent-motivo').value        = '';
  document.getElementById('ent-recoge-nombre').value = '';
  document.getElementById('ent-recoge-dni').value    = '';
  document.getElementById('motivo-sin-reparar-grupo').style.display = 'none';
  abrirModal('modal-entrega');
  setTimeout(iniciarFirma, 150);
}

function toggleMotivoSinReparar() {
  document.getElementById('motivo-sin-reparar-grupo').style.display =
    document.getElementById('ent-sin-reparar').value === 'Sí' ? 'block' : 'none';
}

function iniciarFirma() {
  var canvas = document.getElementById('firma-canvas');
  if (!canvas) return;
  var rect = canvas.getBoundingClientRect();
  canvas.width  = rect.width  * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  firmaCtx = canvas.getContext('2d');
  firmaCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
  firmaCtx.strokeStyle = '#1A1814';
  firmaCtx.lineWidth = 2;
  firmaCtx.lineCap = 'round';
  firmaCtx.lineJoin = 'round';
  function getPos(e) {
    var r = canvas.getBoundingClientRect();
    var s = e.touches ? e.touches[0] : e;
    return { x: s.clientX - r.left, y: s.clientY - r.top };
  }
  canvas.onmousedown = canvas.ontouchstart = function(e) { e.preventDefault(); firmaDibujando = true; var p = getPos(e); firmaCtx.beginPath(); firmaCtx.moveTo(p.x, p.y); };
  canvas.onmousemove = canvas.ontouchmove  = function(e) { e.preventDefault(); if (!firmaDibujando) return; var p = getPos(e); firmaCtx.lineTo(p.x, p.y); firmaCtx.stroke(); };
  canvas.onmouseup   = canvas.ontouchend   = function() { firmaDibujando = false; };
  canvas.onmouseleave = function() { firmaDibujando = false; };
}

function limpiarFirma() {
  if (!firmaCtx) return;
  var canvas = document.getElementById('firma-canvas');
  firmaCtx.clearRect(0, 0, canvas.width, canvas.height);
}

function esCanvasVacio(canvas) {
  var data = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
  for (var i = 0; i < data.length; i++) { if (data[i] !== 0) return false; }
  return true;
}

async function confirmarEntrega() {
  var canvas       = document.getElementById('firma-canvas');
  var fechaReal    = document.getElementById('ent-fecha').value;
  var recogeNombre = val('ent-recoge-nombre');
  var recogeDni    = val('ent-recoge-dni');
  var sinReparar   = val('ent-sin-reparar');
  var motivo       = val('ent-motivo');
  if (!fechaReal)    { toast('Indica la fecha de entrega', 'error'); return; }
  if (!recogeNombre) { toast('Indica quién recoge', 'error'); return; }
  if (esCanvasVacio(canvas)) { toast('Por favor recoge la firma del cliente', 'error'); return; }
  var firmaDataUrl = canvas.toDataURL('image/png');
  var idx = reparaciones.findIndex(function(r) { return r.id === reparacionEntregaId; });
  if (idx === -1) return;
  var rep = reparaciones[idx];
  await apiUpdate('Reparaciones!A' + (idx+2) + ':R' + (idx+2), [
    rep.id, rep.numero, rep.idReloj, rep.fechaEntrada, rep.problema, rep.estadoVisual,
    rep.observaciones, rep.precio, rep.aCuenta, rep.presupuestoAceptado, 'Entregada',
    rep.fechaEstimada, fechaReal, recogeNombre, recogeDni, sinReparar, motivo, firmaDataUrl
  ]);
  reparaciones[idx] = Object.assign({}, rep, { estado: 'Entregada', fechaEntregaReal: fechaReal, recogeNombre: recogeNombre, recogeDni: recogeDni, sinReparar: sinReparar, motivoSinReparar: motivo, firma: firmaDataUrl });
  cerrarModal('modal-entrega');
  renderizarListaReparaciones(reparaciones);
  if (relojActivoId) verReloj(relojActivoId);
  if (reparacionActivaId === reparacionEntregaId) verReparacion(reparacionEntregaId);
  toast('Entrega registrada correctamente', 'success');
}

// ============================================================
// IMPRESIÓN — TICKETS ESC/POS 80mm / RAWBT
// ============================================================
var TALLER = {
  nombre:    'Repuesto Refer S.L.',
  direccion: 'Calle Atarazanas, 9',
  telefono:  '640 238 819'
};

// Ancho en caracteres para fuente normal en 80mm
var ANCHO = 48;

// Comandos ESC/POS
var ESC = '\x1B';
var GS  = '\x1D';

var CMD = {
  init:         ESC + '@',           // Inicializar impresora
  boldOn:       ESC + 'E\x01',       // Negrita activada
  boldOff:      ESC + 'E\x00',       // Negrita desactivada
  bigOn:        GS  + '!\x11',       // Doble ancho + doble alto
  bigOff:       GS  + '!\x00',       // Tamaño normal
  tamanoOn:     GS  + '!\x01',       // Doble alto (letra mas grande, mismo ancho)
  tamanoOff:    GS  + '!\x00',       // Tamaño normal
  centerOn:     ESC + 'a\x01',       // Centrar
  centerOff:    ESC + 'a\x00',       // Alinear izquierda
  lineSpacing:  ESC + '3\x50',       // Espaciado entre lineas aumentado
  lineNormal:   ESC + '2',           // Espaciado normal
  cut:          GS  + 'V\x41\x03',   // Corte parcial con margen
  feed:         ESC + 'd\x04'        // Avanzar 4 lineas antes de cortar
};

function linea(char) {
  return (char || '-').repeat(ANCHO);
}

function centrar(texto) {
  var t = String(texto||'').substring(0, ANCHO);
  var pad = Math.floor((ANCHO - t.length) / 2);
  return ' '.repeat(pad) + t;
}

function trocear(texto, ancho) {
  ancho = ancho || ANCHO;
  var palabras = String(texto||'').split(' ');
  var lineas = [], actual = '';
  for (var i = 0; i < palabras.length; i++) {
    var p = palabras[i];
    if ((actual + (actual ? ' ' : '') + p).length <= ancho) {
      actual = actual + (actual ? ' ' : '') + p;
    } else {
      if (actual) lineas.push(actual);
      actual = p.substring(0, ancho);
    }
  }
  if (actual) lineas.push(actual);
  return lineas;
}

function bold(texto) { return CMD.boldOn + texto + CMD.boldOff; }
function big(texto)  { return CMD.bigOn  + texto + CMD.bigOff; }

// ── RESGUARDO DE ENTRADA (copia cliente + copia taller) ─────
function generarResguardoEntrada(rep) {
  var reloj   = relojes.find(function(r) { return r.id === rep.idReloj; });
  var cliente = reloj ? clientes.find(function(c) { return c.id === reloj.idCliente; }) : null;
  var nombreC = cliente ? cliente.nombre    : '—';
  var telC    = cliente ? cliente.telefono  || '—' : '—';
  var dniC    = cliente ? cliente.dni       || '—' : '—';
  var marcaR  = reloj   ? (reloj.marca||'') + (reloj.modelo ? ' ' + reloj.modelo : '') : '—';
  var serieR  = reloj   ? reloj.serie || '—' : '—';
  var precioStr  = rep.precio  ? rep.precio  + ' EUR' : '—';
  var aCuentaStr = rep.aCuenta ? rep.aCuenta + ' EUR' : '—';
  var restanVal  = (rep.precio && rep.aCuenta)
    ? (parseFloat(rep.precio) - parseFloat(rep.aCuenta)).toFixed(2) + ' EUR'
    : (rep.precio ? rep.precio + ' EUR' : '—');

  var ticket = CMD.init;
  ticket += CMD.tamanoOn;            // Letra mas grande en todo el ticket

  // ── COPIA CLIENTE ──────────────────────────────────────────
  ticket += CMD.centerOn;
  ticket += bold('        REFER S.L.') + '\n';
  ticket += 'TODO EN RELOJERIA DESDE 1976\n';
  ticket += linea('=') + '\n';
  ticket += bold('   [PARTE 1: PARA EL CLIENTE]') + '\n';
  ticket += linea('=') + '\n';
  ticket += CMD.centerOff;

  ticket += bold('NUMERO REPARACION: ' + (rep.numero||'—')) + '\n';
  ticket += '\n';
  ticket += bold('Marca: ') + marcaR + '\n';
  ticket += bold('Reparacion: ') + '\n';
  trocear(rep.problema||'—', ANCHO - 2).forEach(function(l) { ticket += '  ' + l + '\n'; });
  ticket += '\n';
  ticket += bold('Fecha entrada: ') + (rep.fechaEntrada||'—') + '\n';
  ticket += bold('Precio total:  ') + precioStr + '\n';
  ticket += bold('A cuenta:      ') + aCuentaStr + '\n';
  ticket += bold('Restan:        ') + restanVal + '\n';
  ticket += linea('-') + '\n';

  // Mensaje WhatsApp
  ticket += 'Seguimiento de su reparacion:\n';
  ticket += 'Contactenos via WhatsApp para\n';
  ticket += 'consultar el estado.\n';
  ticket += '\n';
  ticket += bold('WhatsApp: ' + TALLER.telefono) + '\n';
  ticket += 'Mencione su nombre o numero\n';
  ticket += 'de orden al escribirnos.\n';
  ticket += '\n';

  ticket += CMD.centerOn;
  ticket += bold('Gracias por confiar en nosotros') + '\n';
  ticket += CMD.centerOff;
  ticket += CMD.feed;
  ticket += CMD.cut;

  // ── COPIA TALLER ───────────────────────────────────────────
  ticket += CMD.centerOn;
  ticket += bold('   [PARTE 2: PARA EL TALLER]') + '\n';
  ticket += linea('=') + '\n';
  ticket += CMD.centerOff;

  ticket += bold('NUMERO REPARACION: ' + (rep.numero||'—')) + '\n';
  ticket += '\n';
  ticket += bold('Nombre cliente: ') + nombreC + '\n';
  ticket += bold('Telefono:       ') + telC + '\n';
  ticket += 'DNI:            ' + dniC + '\n';
  ticket += bold('Marca: ') + marcaR + '\n';
  ticket += 'Serie: ' + serieR + '\n';
  ticket += '\n';
  ticket += bold('Reparacion:') + '\n';
  trocear(rep.problema||'—', ANCHO - 2).forEach(function(l) { ticket += '  ' + l + '\n'; });

  if (rep.estadoVisual) {
    ticket += '\n';
    ticket += 'Estado visual al entrar:\n';
    trocear(rep.estadoVisual, ANCHO - 2).forEach(function(l) { ticket += '  ' + l + '\n'; });
  }

  ticket += '\n';
  ticket += bold('Fecha entrada:  ') + (rep.fechaEntrada||'—') + '\n';
  ticket += bold('Precio total:   ') + precioStr + '\n';
  ticket += bold('A cuenta:       ') + aCuentaStr + '\n';
  ticket += bold('Restan:         ') + restanVal + '\n';
  ticket += linea('-') + '\n';
  ticket += 'Anotaciones de taller:\n';
  ticket += '\n';
  ticket += linea('_') + '\n';
  ticket += '\n';
  ticket += linea('_') + '\n';
  ticket += '\n';
  ticket += linea('_') + '\n';
  ticket += '\n';
  ticket += linea('_') + '\n';
  ticket += '\n';
  ticket += linea('_') + '\n';
  ticket += '\n';
  ticket += CMD.feed;
  ticket += CMD.cut;

  return ticket;
}

// ── TICKET DE ENTREGA (solo cliente, sin firma) ─────────────
function generarTicketEntrega(rep) {
  var reloj   = relojes.find(function(r) { return r.id === rep.idReloj; });
  var cliente = reloj ? clientes.find(function(c) { return c.id === reloj.idCliente; }) : null;
  var nombreC = cliente ? cliente.nombre   : '—';
  var telC    = cliente ? cliente.telefono || '—' : '—';
  var marcaR  = reloj   ? (reloj.marca||'') + (reloj.modelo ? ' ' + reloj.modelo : '') : '—';
  var precioStr  = rep.precio  ? rep.precio  + ' EUR' : '—';
  var aCuentaStr = rep.aCuenta ? rep.aCuenta + ' EUR' : '0.00 EUR';
  var restanVal  = (rep.precio && rep.aCuenta)
    ? (parseFloat(rep.precio) - parseFloat(rep.aCuenta)).toFixed(2) + ' EUR'
    : (rep.precio ? rep.precio + ' EUR' : '—');

  var ticket = CMD.init;
  ticket += CMD.tamanoOn;            // Letra mas grande
  ticket += CMD.centerOn;
  ticket += bold('        REFER S.L.') + '\n';
  ticket += 'TODO EN RELOJERIA DESDE 1976\n';
  ticket += linea('=') + '\n';
  ticket += bold('    TICKET DE ENTREGA') + '\n';
  ticket += linea('=') + '\n';
  ticket += CMD.centerOff;

  ticket += bold('NUMERO REPARACION: ' + (rep.numero||'—')) + '\n';
  ticket += 'Fecha entrega: ' + (rep.fechaEntregaReal||'—') + '\n';
  ticket += linea('-') + '\n';

  ticket += bold('Nombre: ') + nombreC + '\n';
  ticket += 'Tel:    ' + telC + '\n';
  ticket += linea('-') + '\n';

  ticket += bold('Marca: ') + marcaR + '\n';
  ticket += '\n';
  ticket += bold('Trabajo realizado:') + '\n';
  trocear(rep.problema||'—', ANCHO - 2).forEach(function(l) { ticket += '  ' + l + '\n'; });

  if (rep.sinReparar === 'Sí') {
    ticket += '\n';
    ticket += bold('ENTREGADO SIN REPARAR') + '\n';
    if (rep.motivoSinReparar) {
      trocear(rep.motivoSinReparar, ANCHO - 2).forEach(function(l) { ticket += '  ' + l + '\n'; });
    }
  }

  ticket += linea('-') + '\n';
  ticket += 'Recoge: ' + (rep.recogeNombre||'—') + '\n';
  if (rep.recogeDni) ticket += 'DNI:    ' + rep.recogeDni + '\n';
  ticket += linea('=') + '\n';

  ticket += bold('Precio total:  ') + precioStr + '\n';
  ticket += bold('A cuenta:      ') + aCuentaStr + '\n';
  ticket += bold('RESTAN:        ') + restanVal + '\n';
  ticket += linea('=') + '\n';
  ticket += '\n';
  ticket += CMD.centerOn;
  ticket += bold('Gracias por confiar en nosotros') + '\n';
  ticket += CMD.centerOff;
  ticket += CMD.feed;
  ticket += CMD.cut;

  return ticket;
}

// ── ENVÍO AL SERVIDOR PUENTE ────────────────────────────────
var SERVIDOR_IMPRESORA = 'http://192.168.1.134:8765/print';

async function imprimirEscPos(datos) {
  // Convertir string ESC/POS a bytes y codificar en base64
  var bytes = new Uint8Array(datos.length);
  for (var i = 0; i < datos.length; i++) {
    bytes[i] = datos.charCodeAt(i) & 0xFF;
  }
  var b64 = btoa(String.fromCharCode.apply(null, bytes));

  try {
    var resp = await fetch(SERVIDOR_IMPRESORA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: b64 })
    });
    var resultado = await resp.json();
    if (resultado.ok) {
      toast('Ticket enviado a la impresora', 'success');
    } else {
      toast('Error impresora: ' + resultado.msg, 'error');
      abrirVistaPreviaTicket(datos);
    }
  } catch (e) {
    // Si no hay servidor puente, mostrar vista previa
    toast('Servidor no disponible — mostrando vista previa', '');
    abrirVistaPreviaTicket(datos);
  }
}

function abrirVistaPreviaTicket(datos) {
  // Limpiar comandos ESC/POS para mostrar texto legible en pantalla
  var texto = datos
    .replace(/\x1B[@Ea\x00\x01]|\x1BD\x04|\x1Bd\x04|\x1Ba[\x00\x01]|\x1BE[\x00\x01]|\x1D[!V][\x00\x11\x41\x03]/g, '')
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '');

  var win = window.open('', '_blank', 'width=420,height=750,menubar=no,toolbar=no');
  if (!win) { toast('Permite las ventanas emergentes en el navegador', 'error'); return; }
  win.document.write(
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Ticket</title>' +
    '<style>' +
    'body{margin:0;padding:12px 16px;background:#fff;font-family:"Courier New",Courier,monospace;font-size:13px;line-height:1.5;white-space:pre;word-break:break-all}' +
    'button{display:block;width:100%;padding:10px;margin-bottom:14px;background:#2B4D3F;color:#fff;border:none;font-size:15px;cursor:pointer;border-radius:6px;font-family:sans-serif}' +
    '@media print{button{display:none}body{font-size:11px;padding:0}}' +
    '</style></head><body>' +
    '<button onclick="window.print()">🖨 Imprimir</button>' +
    texto.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') +
    '</body></html>'
  );
  win.document.close();
}

function imprimirResguardoEntrada(idReparacion) {
  var rep = reparaciones.find(function(r) { return r.id === idReparacion; });
  if (!rep) return;
  imprimirEscPos(generarResguardoEntrada(rep));
}

function imprimirTicketEntrega(idReparacion) {
  var rep = reparaciones.find(function(r) { return r.id === idReparacion; });
  if (!rep) return;
  imprimirEscPos(generarTicketEntrega(rep));
}

// ============================================================
// ELIMINAR
// ============================================================
function confirmarEliminarCliente(id, nombre) {
  mostrarConfirm('¿Eliminar cliente?', 'Se eliminará a "' + nombre + '" y todos sus relojes. Esta acción no se puede deshacer.', async function() {
    await eliminarFilaPorId('Clientes', id);
    var suyos = relojes.filter(function(r) { return r.idCliente === id; });
    for (var i = 0; i < suyos.length; i++) await eliminarFilaPorId('Relojes', suyos[i].id);
    clientes = clientes.filter(function(c) { return c.id !== id; });
    relojes  = relojes.filter(function(r) { return r.idCliente !== id; });
    renderizarListaClientes(clientes);
    renderizarListaRelojosGlobal(relojes);
    if (clienteActivoId === id) volverAClientes();
    toast('Cliente eliminado', 'success');
  });
}

function confirmarEliminarReloj(id, marca) {
  mostrarConfirm('¿Eliminar reloj?', 'Se eliminará el reloj "' + (marca||'sin marca') + '". Esta acción no se puede deshacer.', async function() {
    await eliminarFilaPorId('Relojes', id);
    relojes = relojes.filter(function(r) { return r.id !== id; });
    renderizarListaRelojosGlobal(relojes);
    if (clienteActivoId) verCliente(clienteActivoId);
    if (relojActivoId === id) volverAClientes();
    toast('Reloj eliminado', 'success');
  });
}

function confirmarEliminarReparacion(id) {
  mostrarConfirm('¿Eliminar reparación?', 'Se eliminará esta reparación. Esta acción no se puede deshacer.', async function() {
    await eliminarFilaPorId('Reparaciones', id);
    reparaciones = reparaciones.filter(function(r) { return r.id !== id; });
    renderizarListaReparaciones(reparaciones);
    if (reparacionActivaId === id) volverAReparaciones();
    toast('Reparación eliminada', 'success');
  });
}

async function eliminarFilaPorId(hoja, id) {
  var rows = await apiGet(hoja + '!A2:A');
  var rowIdx = rows.findIndex(function(r) { return r[0] === id; });
  if (rowIdx === -1) return;
  var sheetIdMap = await getSheetIds();
  var sheetId = sheetIdMap[hoja];
  if (sheetId === undefined) return;
  await apiBatchUpdate([{ deleteDimension: { range: { sheetId: sheetId, dimension: 'ROWS', startIndex: rowIdx + 1, endIndex: rowIdx + 2 } } }]);
}

// ============================================================
// UI HELPERS
// ============================================================
function abrirModal(id)  { document.getElementById(id).classList.add('open'); }
function cerrarModal(id) { document.getElementById(id).classList.remove('open'); }

function mostrarConfirm(title, text, cb) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-text').textContent  = text;
  document.getElementById('confirm-overlay').classList.add('open');
  document.getElementById('confirm-ok').onclick = async function() { cerrarConfirm(); await cb(); };
}
function cerrarConfirm() { document.getElementById('confirm-overlay').classList.remove('open'); }

function toast(msg, tipo) {
  tipo = tipo || '';
  var el = document.createElement('div');
  el.className = 'toast ' + tipo;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(function() { el.remove(); }, 3000);
}

document.addEventListener('click', function(e) {
  if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('open');
  if (e.target.id === 'confirm-overlay') cerrarConfirm();
  // Cerrar dropdowns de cliente si se hace click fuera
  ['rep-cliente-search','ped-cliente-search','con-cliente-search'].forEach(function(sid) {
    var did = sid.replace('-search', '-dropdown');
    if (!e.target.closest('#' + sid) && !e.target.closest('#' + did)) {
      var dd = document.getElementById(did);
      if (dd) dd.style.display = 'none';
    }
  });
});

// ============================================================
// PEDIDOS
// ============================================================
var pedidos = [];
var editandoPedidoId = null;

async function cargarPedidos() {
  var rows = await apiGet('Pedidos!A2:M');
  pedidos = rows.map(function(r) { return {
    id: r[0]||'', idCliente: r[1]||'', idReloj: r[2]||'', idReparacion: r[3]||'',
    descripcion: r[4]||'', referencia: r[5]||'', proveedor: r[6]||'',
    precio: r[7]||'', estado: r[8]||'Pendiente',
    fechaPedido: r[9]||'', fechaEstimada: r[10]||'', fechaLlegada: r[11]||'',
    notas: r[12]||''
  }; });
  renderizarListaPedidos(pedidos);
}

function badgeEstadoPed(estado) {
  var map = { 'Pendiente': 'badge-ped-pendiente', 'Pedido': 'badge-ped-pedido', 'Recibido': 'badge-ped-recibido', 'Cancelado': 'badge-ped-cancelado' };
  return map[estado] || 'badge-ped-pendiente';
}

function renderizarListaPedidos(lista) {
  var el = document.getElementById('lista-pedidos');
  if (!lista.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📦</div><div class="empty-state-text">No hay pedidos registrados.</div></div>';
    return;
  }
  el.innerHTML = lista.map(function(p) {
    var c   = p.idCliente   ? clientes.find(function(x) { return x.id === p.idCliente; })   : null;
    var rel = p.idReloj     ? relojes.find(function(x)  { return x.id === p.idReloj; })     : null;
    var rep = p.idReparacion? reparaciones.find(function(x){ return x.id === p.idReparacion; }) : null;
    var contexto = [c?c.nombre:'', rel?nombreReloj(rel):'', rep?rep.numero:''].filter(Boolean).join(' · ');
    return '<div class="list-item" onclick="abrirModalPedido(\'' + (p.idCliente||'') + '\',\'' + (p.idReloj||'') + '\',\'' + (p.idReparacion||'') + '\',\'' + p.id + '\')">' +
      '<div class="list-item-main">' +
        '<div class="list-item-name">' + (p.descripcion||'Sin descripción').substring(0,60) + '</div>' +
        '<div class="list-item-sub">' + (contexto||'Sin asociar') + (p.proveedor?' · '+p.proveedor:'') + '</div>' +
        '<div class="list-item-sub" style="margin-top:2px">' + (p.fechaPedido||'') + (p.precio?' · '+p.precio+' €':'') + '</div>' +
      '</div>' +
      '<div class="list-item-actions">' +
        '<span class="badge ' + badgeEstadoPed(p.estado) + '">' + p.estado + '</span>' +
        '<button class="btn btn-danger btn-sm" onclick="event.stopPropagation();confirmarEliminarPedido(\'' + p.id + '\')">✕</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function filtrarPedidos() {
  var q  = document.getElementById('search-pedidos').value.toLowerCase();
  var st = document.getElementById('filtro-estado-ped').value;
  renderizarListaPedidos(pedidos.filter(function(p) {
    var c = p.idCliente ? clientes.find(function(x) { return x.id === p.idCliente; }) : null;
    var texto = [p.descripcion, p.proveedor, p.referencia, c?c.nombre:''].join(' ').toLowerCase();
    return texto.includes(q) && (!st || p.estado === st);
  }));
}

// Buscador de cliente en modal pedido
function filtrarClientesModalPed() {
  filtrarClientesDropdown('ped-cliente-search', 'ped-cliente-dropdown', function(c) {
    seleccionarClientePed(c.id, c.nombre);
  });
}

function seleccionarClientePed(id, nombre) {
  document.getElementById('ped-cliente').value = id;
  document.getElementById('ped-cliente-search').value = '';
  document.getElementById('ped-cliente-dropdown').style.display = 'none';
  var pill = document.getElementById('ped-cliente-pill');
  pill.style.display = 'flex';
  document.getElementById('ped-cliente-pill-nombre').textContent = nombre;
  // Cargar relojes del cliente
  var relojesC = relojes.filter(function(r) { return r.idCliente === id; });
  var selRel = document.getElementById('ped-reloj');
  selRel.innerHTML = '<option value="">— Sin reloj —</option>' +
    relojesC.map(function(r) { return '<option value="' + r.id + '">' + nombreReloj(r) + '</option>'; }).join('');
  document.getElementById('ped-reloj-grupo').style.display = 'block';
  document.getElementById('ped-rep-grupo').style.display = 'none';
  document.getElementById('ped-reparacion').innerHTML = '<option value="">— Sin reparación —</option>';
}

function limpiarClientePed() {
  document.getElementById('ped-cliente').value = '';
  document.getElementById('ped-cliente-search').value = '';
  document.getElementById('ped-cliente-dropdown').style.display = 'none';
  document.getElementById('ped-cliente-pill').style.display = 'none';
  document.getElementById('ped-reloj-grupo').style.display = 'none';
  document.getElementById('ped-rep-grupo').style.display = 'none';
}

function actualizarRepsPed() {
  var idReloj = document.getElementById('ped-reloj').value;
  var selRep = document.getElementById('ped-reparacion');
  if (!idReloj) {
    document.getElementById('ped-rep-grupo').style.display = 'none';
    return;
  }
  var repsReloj = reparaciones.filter(function(r) { return r.idReloj === idReloj; });
  selRep.innerHTML = '<option value="">— Sin reparación —</option>' +
    repsReloj.map(function(r) { return '<option value="' + r.id + '">' + (r.numero||r.id) + ' · ' + (r.problema||'').substring(0,40) + '</option>'; }).join('');
  document.getElementById('ped-rep-grupo').style.display = 'block';
}

function abrirModalPedido(idCliente, idReloj, idReparacion, idPedido) {
  idCliente    = idCliente    || null;
  idReloj      = idReloj      || null;
  idReparacion = idReparacion || null;
  idPedido     = idPedido     || null;
  editandoPedidoId = idPedido;

  var p = idPedido ? pedidos.find(function(x) { return x.id === idPedido; }) : null;
  document.getElementById('modal-pedido-title').textContent = p ? 'Editar pedido' : 'Nuevo pedido';

  // Limpiar
  limpiarClientePed();
  document.getElementById('ped-descripcion').value   = p ? p.descripcion : '';
  document.getElementById('ped-referencia').value    = p ? p.referencia  : '';
  document.getElementById('ped-proveedor').value     = p ? p.proveedor   : '';
  document.getElementById('ped-precio').value        = p ? p.precio      : '';
  document.getElementById('ped-estado').value        = p ? p.estado      : 'Pendiente';
  document.getElementById('ped-fecha-pedido').value  = p ? p.fechaPedido : new Date().toISOString().split('T')[0];
  document.getElementById('ped-fecha-estimada').value= p ? p.fechaEstimada : '';
  document.getElementById('ped-notas').value         = p ? p.notas       : '';

  // Preseleccionar contexto
  var cid = p ? p.idCliente : idCliente;
  if (cid) {
    var c = clientes.find(function(x) { return x.id === cid; });
    if (c) seleccionarClientePed(c.id, c.nombre);
    var rid = p ? p.idReloj : idReloj;
    if (rid) {
      document.getElementById('ped-reloj').value = rid;
      actualizarRepsPed();
      var repid = p ? p.idReparacion : idReparacion;
      if (repid) document.getElementById('ped-reparacion').value = repid;
    }
  }

  abrirModal('modal-pedido');
}

async function guardarPedido() {
  var desc = val('ped-descripcion');
  if (!desc) { toast('La descripción es obligatoria', 'error'); return; }
  var idCliente    = document.getElementById('ped-cliente').value    || '';
  var idReloj      = document.getElementById('ped-reloj').value      || '';
  var idReparacion = document.getElementById('ped-reparacion').value || '';
  var referencia   = val('ped-referencia'), proveedor = val('ped-proveedor');
  var precio       = val('ped-precio'), estado = val('ped-estado');
  var fechaPedido  = document.getElementById('ped-fecha-pedido').value  || '';
  var fechaEst     = document.getElementById('ped-fecha-estimada').value || '';
  var notas        = val('ped-notas');

  if (editandoPedidoId) {
    var idx = pedidos.findIndex(function(p) { return p.id === editandoPedidoId; });
    await apiUpdate('Pedidos!A' + (idx+2) + ':M' + (idx+2), [editandoPedidoId, idCliente, idReloj, idReparacion, desc, referencia, proveedor, precio, estado, fechaPedido, fechaEst, '', notas]);
    pedidos[idx] = { id: editandoPedidoId, idCliente: idCliente, idReloj: idReloj, idReparacion: idReparacion, descripcion: desc, referencia: referencia, proveedor: proveedor, precio: precio, estado: estado, fechaPedido: fechaPedido, fechaEstimada: fechaEst, fechaLlegada: '', notas: notas };
    toast('Pedido actualizado', 'success');
  } else {
    var id = uid();
    await apiAppend('Pedidos', [id, idCliente, idReloj, idReparacion, desc, referencia, proveedor, precio, estado, fechaPedido, fechaEst, '', notas]);
    pedidos.push({ id: id, idCliente: idCliente, idReloj: idReloj, idReparacion: idReparacion, descripcion: desc, referencia: referencia, proveedor: proveedor, precio: precio, estado: estado, fechaPedido: fechaPedido, fechaEstimada: fechaEst, fechaLlegada: '', notas: notas });
    toast('Pedido creado', 'success');
  }
  cerrarModal('modal-pedido');
  renderizarListaPedidos(pedidos);
}

function confirmarEliminarPedido(id) {
  mostrarConfirm('¿Eliminar pedido?', 'Esta acción no se puede deshacer.', async function() {
    await eliminarFilaPorId('Pedidos', id);
    pedidos = pedidos.filter(function(p) { return p.id !== id; });
    renderizarListaPedidos(pedidos);
    toast('Pedido eliminado', 'success');
  });
}

// ============================================================
// CONSULTAS
// ============================================================
var consultas = [];
var editandoConsultaId = null;

async function cargarConsultas() {
  var rows = await apiGet('Consultas!A2:I');
  consultas = rows.map(function(r) { return {
    id: r[0]||'', idCliente: r[1]||'', idReloj: r[2]||'', idReparacion: r[3]||'',
    asunto: r[4]||'', descripcion: r[5]||'', respuesta: r[6]||'',
    estado: r[7]||'Abierta', fecha: r[8]||''
  }; });
  renderizarListaConsultas(consultas);
}

function badgeEstadoCon(estado) {
  var map = { 'Abierta': 'badge-con-abierta', 'Respondida': 'badge-con-respondida', 'Cerrada': 'badge-con-cerrada' };
  return map[estado] || 'badge-con-abierta';
}

function renderizarListaConsultas(lista) {
  var el = document.getElementById('lista-consultas');
  if (!lista.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💬</div><div class="empty-state-text">No hay consultas registradas.</div></div>';
    return;
  }
  el.innerHTML = lista.map(function(c) {
    var cli = c.idCliente ? clientes.find(function(x) { return x.id === c.idCliente; }) : null;
    var rel = c.idReloj   ? relojes.find(function(x)  { return x.id === c.idReloj; })   : null;
    var rep = c.idReparacion ? reparaciones.find(function(x) { return x.id === c.idReparacion; }) : null;
    var contexto = [cli?cli.nombre:'', rel?nombreReloj(rel):'', rep?rep.numero:''].filter(Boolean).join(' · ');
    return '<div class="list-item" onclick="abrirModalConsulta(\'' + (c.idCliente||'') + '\',\'' + (c.idReloj||'') + '\',\'' + (c.idReparacion||'') + '\',\'' + c.id + '\')">' +
      '<div class="list-item-main">' +
        '<div class="list-item-name">' + (c.asunto||'Sin asunto') + '</div>' +
        '<div class="list-item-sub">' + (contexto||'Sin asociar') + '</div>' +
        '<div class="list-item-sub" style="margin-top:2px">' + (c.fecha||'') + (c.descripcion?' · '+(c.descripcion).substring(0,40):'') + '</div>' +
      '</div>' +
      '<div class="list-item-actions">' +
        '<span class="badge ' + badgeEstadoCon(c.estado) + '">' + c.estado + '</span>' +
        '<button class="btn btn-danger btn-sm" onclick="event.stopPropagation();confirmarEliminarConsulta(\'' + c.id + '\')">✕</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function filtrarConsultas() {
  var q  = document.getElementById('search-consultas').value.toLowerCase();
  var st = document.getElementById('filtro-estado-con').value;
  renderizarListaConsultas(consultas.filter(function(c) {
    var cli = c.idCliente ? clientes.find(function(x) { return x.id === c.idCliente; }) : null;
    var texto = [c.asunto, c.descripcion, cli?cli.nombre:''].join(' ').toLowerCase();
    return texto.includes(q) && (!st || c.estado === st);
  }));
}

// Buscador de cliente en modal consulta
function filtrarClientesModalCon() {
  filtrarClientesDropdown('con-cliente-search', 'con-cliente-dropdown', function(c) {
    seleccionarClienteCon(c.id, c.nombre);
  });
}

function seleccionarClienteCon(id, nombre) {
  document.getElementById('con-cliente').value = id;
  document.getElementById('con-cliente-search').value = '';
  document.getElementById('con-cliente-dropdown').style.display = 'none';
  var pill = document.getElementById('con-cliente-pill');
  pill.style.display = 'flex';
  document.getElementById('con-cliente-pill-nombre').textContent = nombre;
  var relojesC = relojes.filter(function(r) { return r.idCliente === id; });
  var selRel = document.getElementById('con-reloj');
  selRel.innerHTML = '<option value="">— Sin reloj —</option>' +
    relojesC.map(function(r) { return '<option value="' + r.id + '">' + nombreReloj(r) + '</option>'; }).join('');
  document.getElementById('con-reloj-grupo').style.display = 'block';
  document.getElementById('con-rep-grupo').style.display = 'none';
}

function limpiarClienteCon() {
  document.getElementById('con-cliente').value = '';
  document.getElementById('con-cliente-search').value = '';
  document.getElementById('con-cliente-dropdown').style.display = 'none';
  document.getElementById('con-cliente-pill').style.display = 'none';
  document.getElementById('con-reloj-grupo').style.display = 'none';
  document.getElementById('con-rep-grupo').style.display = 'none';
}

function actualizarRepsCon() {
  var idReloj = document.getElementById('con-reloj').value;
  var selRep = document.getElementById('con-reparacion');
  if (!idReloj) { document.getElementById('con-rep-grupo').style.display = 'none'; return; }
  var repsReloj = reparaciones.filter(function(r) { return r.idReloj === idReloj; });
  selRep.innerHTML = '<option value="">— Sin reparación —</option>' +
    repsReloj.map(function(r) { return '<option value="' + r.id + '">' + (r.numero||r.id) + ' · ' + (r.problema||'').substring(0,40) + '</option>'; }).join('');
  document.getElementById('con-rep-grupo').style.display = 'block';
}

function abrirModalConsulta(idCliente, idReloj, idReparacion, idConsulta) {
  idCliente    = idCliente    || null;
  idReloj      = idReloj      || null;
  idReparacion = idReparacion || null;
  idConsulta   = idConsulta   || null;
  editandoConsultaId = idConsulta;

  var c = idConsulta ? consultas.find(function(x) { return x.id === idConsulta; }) : null;
  document.getElementById('modal-consulta-title').textContent = c ? 'Editar consulta' : 'Nueva consulta';

  limpiarClienteCon();
  document.getElementById('con-asunto').value      = c ? c.asunto      : '';
  document.getElementById('con-descripcion').value = c ? c.descripcion : '';
  document.getElementById('con-respuesta').value   = c ? c.respuesta   : '';
  document.getElementById('con-estado').value      = c ? c.estado      : 'Abierta';
  document.getElementById('con-fecha').value       = c ? c.fecha : new Date().toISOString().split('T')[0];

  var cid = c ? c.idCliente : idCliente;
  if (cid) {
    var cli = clientes.find(function(x) { return x.id === cid; });
    if (cli) seleccionarClienteCon(cli.id, cli.nombre);
    var rid = c ? c.idReloj : idReloj;
    if (rid) {
      document.getElementById('con-reloj').value = rid;
      actualizarRepsCon();
      var repid = c ? c.idReparacion : idReparacion;
      if (repid) document.getElementById('con-reparacion').value = repid;
    }
  }

  abrirModal('modal-consulta');
}

async function guardarConsulta() {
  var asunto = val('con-asunto');
  if (!asunto) { toast('El asunto es obligatorio', 'error'); return; }
  var idCliente    = document.getElementById('con-cliente').value    || '';
  var idReloj      = document.getElementById('con-reloj').value      || '';
  var idReparacion = document.getElementById('con-reparacion').value || '';
  var descripcion  = val('con-descripcion'), respuesta = val('con-respuesta');
  var estado       = val('con-estado');
  var fecha        = document.getElementById('con-fecha').value || '';

  if (editandoConsultaId) {
    var idx = consultas.findIndex(function(c) { return c.id === editandoConsultaId; });
    await apiUpdate('Consultas!A' + (idx+2) + ':I' + (idx+2), [editandoConsultaId, idCliente, idReloj, idReparacion, asunto, descripcion, respuesta, estado, fecha]);
    consultas[idx] = { id: editandoConsultaId, idCliente: idCliente, idReloj: idReloj, idReparacion: idReparacion, asunto: asunto, descripcion: descripcion, respuesta: respuesta, estado: estado, fecha: fecha };
    toast('Consulta actualizada', 'success');
  } else {
    var id = uid();
    await apiAppend('Consultas', [id, idCliente, idReloj, idReparacion, asunto, descripcion, respuesta, estado, fecha]);
    consultas.push({ id: id, idCliente: idCliente, idReloj: idReloj, idReparacion: idReparacion, asunto: asunto, descripcion: descripcion, respuesta: respuesta, estado: estado, fecha: fecha });
    toast('Consulta creada', 'success');
  }
  cerrarModal('modal-consulta');
  renderizarListaConsultas(consultas);
}

function confirmarEliminarConsulta(id) {
  mostrarConfirm('¿Eliminar consulta?', 'Esta acción no se puede deshacer.', async function() {
    await eliminarFilaPorId('Consultas', id);
    consultas = consultas.filter(function(c) { return c.id !== id; });
    renderizarListaConsultas(consultas);
    toast('Consulta eliminada', 'success');
  });
}

// ============================================================
// HELPER GENERICO — buscador de cliente en dropdown
// ============================================================
function filtrarClientesDropdown(inputId, dropdownId, onSelect) {
  var q = document.getElementById(inputId).value.toLowerCase().trim();
  var dropdown = document.getElementById(dropdownId);
  if (!q) { dropdown.style.display = 'none'; return; }
  var filtrados = clientes.filter(function(c) {
    return c.nombre.toLowerCase().includes(q) || c.telefono.includes(q) || c.dni.toLowerCase().includes(q);
  }).slice(0, 8);
  if (!filtrados.length) {
    dropdown.innerHTML = '<div style="padding:10px 14px;font-size:13px;color:var(--text3)">Sin resultados</div>';
  } else {
    dropdown.innerHTML = filtrados.map(function(c) {
      return '<div style="padding:10px 14px;cursor:pointer;font-size:14px;border-bottom:1px solid var(--border)" onmouseover="this.style.background=\'var(--bg2)\'" onmouseout="this.style.background=\'\'" onclick="(function(){' +
        'document.getElementById(\'' + dropdownId + '\').style.display=\'none\';' +
        '})();window._dropdownCb_' + dropdownId + '(' + JSON.stringify(c) + ')">' +
        '<div style="font-weight:500">' + c.nombre + '</div>' +
        '<div style="font-size:12px;color:var(--text3);font-family:var(--font-mono)">' + (c.telefono||'') + (c.dni?' · '+c.dni:'') + '</div>' +
      '</div>';
    }).join('');
  }
  window['_dropdownCb_' + dropdownId] = onSelect;
  dropdown.style.display = 'block';
}

// ============================================================
// INIT
// ============================================================
cargarGoogleScripts();
