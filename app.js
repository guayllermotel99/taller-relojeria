// ============================================================
// CONFIG
// ============================================================
const CLIENT_ID = '76160976051-deg4u3k5d09jif11pea0gk3qi2cmecpk.apps.googleusercontent.com';
const SHEET_ID  = '1AjeEMxgWksJrcf3qweAQua9frORSzsW8p7s0x_bsEYU';
const SCOPES    = 'https://www.googleapis.com/auth/spreadsheets';
const API_KEY   = ''; // No necesaria con OAuth

// Cabeceras de cada hoja
const HEADERS = {
  Clientes: ['Id_Cliente','Codigo_Cliente','Tipo_Cliente','Nombre_Completo','Nombre_Comercio','Telefono','DNI_CIF','Direccion','Email','Anotaciones','Fecha_Modificacion'],
  Relojes:  ['Id_Reloj','Id_Cliente','Fecha_Alta','Clase','Movimiento','Marca','Modelo','Referencia','Num_Serie','Color_Caja','Material_Correa','Anyo_Aprox','Descripcion'],
  Reparaciones: ['Id_Reparacion','Id_Reloj','Fecha_Entrada','Descripcion_Problema','Estado_Visual','Observaciones_Internas','Precio_Presupuesto','Presupuesto_Aceptado','Estado','Fecha_Entrega_Estimada','Fecha_Entrega_Real','Recoge_Nombre','Recoge_DNI','Sin_Reparar','Motivo_Sin_Reparar','Firma_Base64'],
  Pedidos:  ['Id_Pedido','Id_Cliente','Id_Reloj','Id_Reparacion','Descripcion_Pieza','Referencia_Marca','Proveedor','Precio','Estado','Fecha_Pedido','Fecha_Llegada_Estimada','Fecha_Llegada_Real','Notas'],
  Consultas:['Id_Consulta','Id_Cliente','Id_Reloj','Id_Reparacion','Asunto','Descripcion','Respuesta','Estado','Fecha_Consulta']
};

// ============================================================
// ESTADO
// ============================================================
let tokenClient, accessToken;
let clientes = [], relojes = [];
let editandoClienteId = null, editandoRelojId = null;
let clienteActivoId = null;

// ============================================================
// GOOGLE IDENTITY / AUTH
// ============================================================
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
    callback: async (resp) => {
      if (resp.error) { toast('Error al autenticar', 'error'); return; }
      accessToken = resp.access_token;
      mostrarApp();
      await inicializarHojas();
      await cargarTodo();
    }
  });
}

async function initGapiClient() {
  await gapi.client.init({ discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4'] });
}

function handleSignIn() {
  if (!tokenClient) { toast('Cargando Google...', ''); return; }
  tokenClient.requestAccessToken({ prompt: 'consent' });
}

function handleSignOut() {
  if (accessToken) google.accounts.oauth2.revoke(accessToken);
  accessToken = null;
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

function mostrarApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
}

// ============================================================
// SHEETS API
// ============================================================
async function apiGet(range) {
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const d = await r.json();
  return d.values || [];
}

async function apiAppend(sheet, values) {
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(sheet)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [values] })
    }
  );
}

async function apiUpdate(range, values) {
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [values] })
    }
  );
}

async function apiBatchUpdate(requests) {
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests })
    }
  );
}

// ============================================================
// INICIALIZAR HOJAS (cabeceras si están vacías)
// ============================================================
async function inicializarHojas() {
  for (const [hoja, cabeceras] of Object.entries(HEADERS)) {
    const data = await apiGet(`${hoja}!A1:A1`);
    if (!data.length) {
      await apiUpdate(`${hoja}!A1`, cabeceras);
    }
  }
}

// ============================================================
// CARGAR DATOS
// ============================================================
async function cargarTodo() {
  await Promise.all([cargarClientes(), cargarRelojes(), cargarReparaciones()]);
}

async function cargarClientes() {
  const rows = await apiGet('Clientes!A2:K');
  clientes = rows.map(r => ({
    id: r[0]||'', codigo: r[1]||'', tipo: r[2]||'Particular',
    nombre: r[3]||'', comercio: r[4]||'', telefono: r[5]||'',
    dni: r[6]||'', direccion: r[7]||'', email: r[8]||'',
    anotaciones: r[9]||'', fechaMod: r[10]||''
  }));
  renderizarListaClientes(clientes);
}

async function cargarRelojes() {
  const rows = await apiGet('Relojes!A2:N');
  relojes = rows.map(r => ({
    id: r[0]||'', idCliente: r[1]||'', fechaAlta: r[2]||'',
    clase: r[3]||'', movimiento: r[4]||'', marca: r[5]||'',
    modelo: r[6]||'', referencia: r[7]||'', serie: r[8]||'',
    colorCaja: r[9]||'', materialCorrea: r[10]||'', anyoAprox: r[11]||'',
    descripcion: r[12]||'', estadoVisual: r[13]||''
  }));
  renderizarListaRelojosGlobal(relojes);
}

// ============================================================
// UTILIDADES
// ============================================================
function uid() {
  return Math.random().toString(36).substr(2,8);
}

function hoy() {
  return new Date().toLocaleDateString('es-ES');
}

function codigoCliente(tipo) {
  const prefijos = { 'Particular': 'CLI-PART', 'Relojero/Tienda': 'CLI-REL' };
  const pref = prefijos[tipo] || 'CLI';
  const num = String(clientes.length + 1).padStart(5, '0');
  return `${pref}-${num}`;
}

function badgeTipo(tipo) {
  const map = {
    'Particular': 'badge-particular',
    'Relojero/Tienda': 'badge-tienda'
  };
  return map[tipo] || 'badge-particular';
}

function val(id) { return document.getElementById(id)?.value?.trim() || ''; }

// ============================================================
// NAVEGACIÓN
// ============================================================
function showPanel(nombre) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`panel-${nombre}`)?.classList.add('active');
  event.target.classList.add('active');
}

// ============================================================
// CLIENTES — LISTA
// ============================================================
function renderizarListaClientes(lista) {
  const el = document.getElementById('lista-clientes');
  if (!lista.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">👤</div><div class="empty-state-text">No hay clientes. ¡Añade el primero!</div></div>`;
    return;
  }
  el.innerHTML = lista.map(c => `
    <div class="list-item" onclick="verCliente('${c.id}')">
      <div class="list-item-main">
        <div class="list-item-name">${c.nombre}${c.comercio ? ` <span style="color:var(--text3);font-weight:400">· ${c.comercio}</span>` : ''}</div>
        <div class="list-item-sub">${c.telefono || '—'} · ${c.dni || '—'} · ${c.codigo}</div>
      </div>
      <div class="list-item-actions">
        <span class="badge ${badgeTipo(c.tipo)}">${c.tipo}</span>
        <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();abrirModalCliente('${c.id}')">Editar</button>
        <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();confirmarEliminarCliente('${c.id}','${c.nombre}')">✕</button>
      </div>
    </div>
  `).join('');
}

function filtrarClientes() {
  const q = document.getElementById('search-clientes').value.toLowerCase();
  const filtrados = clientes.filter(c =>
    c.nombre.toLowerCase().includes(q) ||
    c.telefono.includes(q) ||
    c.dni.toLowerCase().includes(q) ||
    c.comercio.toLowerCase().includes(q) ||
    c.email.toLowerCase().includes(q)
  );
  renderizarListaClientes(filtrados);
}

// ============================================================
// CLIENTES — DETALLE
// ============================================================
function verCliente(id) {
  clienteActivoId = id;
  const c = clientes.find(x => x.id === id);
  if (!c) return;
  const relojesCliente = relojes.filter(r => r.idCliente === id);

  const listView = document.getElementById('clientes-list-view');
  const detailView = document.getElementById('clientes-detail-view');

  listView.style.display = 'none';
  detailView.style.display = 'block';

  detailView.innerHTML = `
    <div class="breadcrumb">
      <span class="breadcrumb-link" onclick="volverAClientes()">Clientes</span>
      <span class="breadcrumb-sep">›</span>
      <span>${c.nombre}</span>
    </div>

    <div class="detail-card">
      <div class="detail-header">
        <div>
          <div class="detail-header-title">${c.nombre}</div>
          <div class="detail-header-sub">${c.codigo} · ${c.tipo}</div>
        </div>
        <div class="detail-header-actions">
          <button class="btn-header" onclick="abrirModalCliente('${c.id}')">✎ Editar</button>
        </div>
      </div>
      <div class="detail-body">
        <div class="detail-grid">
          <div class="detail-field">
            <div class="detail-field-label">Teléfono</div>
            <div class="detail-field-value mono">${c.telefono || '<span class="empty">—</span>'}</div>
          </div>
          <div class="detail-field">
            <div class="detail-field-label">DNI / CIF</div>
            <div class="detail-field-value mono">${c.dni || '<span class="empty">—</span>'}</div>
          </div>
          <div class="detail-field">
            <div class="detail-field-label">Email</div>
            <div class="detail-field-value">${c.email || '<span class="empty">—</span>'}</div>
          </div>
          <div class="detail-field">
            <div class="detail-field-label">Comercio</div>
            <div class="detail-field-value">${c.comercio || '<span class="empty">—</span>'}</div>
          </div>
          <div class="detail-field" style="grid-column:1/-1">
            <div class="detail-field-label">Dirección</div>
            <div class="detail-field-value">${c.direccion || '<span class="empty">—</span>'}</div>
          </div>
          ${c.anotaciones ? `
          <div class="detail-field" style="grid-column:1/-1">
            <div class="detail-field-label">Anotaciones</div>
            <div class="detail-field-value">${c.anotaciones}</div>
          </div>` : ''}
        </div>

        <div class="subsection-title">
          Relojes <small style="font-size:14px;font-weight:400;color:var(--text3)">(${relojesCliente.length})</small>
          <button class="btn btn-primary btn-sm" onclick="abrirModalReloj('${c.id}')">+ Añadir reloj</button>
        </div>

        <div id="relojes-cliente-${id}">
          ${relojesCliente.length === 0
            ? `<div class="empty-state" style="padding:24px"><div class="empty-state-text">Este cliente no tiene relojes registrados.</div></div>`
            : relojesCliente.map(r => `
              <div class="reloj-card" onclick="verReloj('${r.id}')">
                <div class="reloj-card-main">
                  <div class="reloj-card-marca">${r.marca || 'Sin marca'} ${r.modelo ? '· ' + r.modelo : ''}</div>
                  <div class="reloj-card-modelo">${r.movimiento} · ${r.clase}</div>
                  ${r.serie ? `<div class="reloj-card-ref">N/S: ${r.serie}</div>` : ''}
                  ${r.referencia ? `<div class="reloj-card-ref">Ref: ${r.referencia}</div>` : ''}
                </div>
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
                  <span class="reloj-clase-badge">${r.clase}</span>
                  <div style="display:flex;gap:6px">
                    <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();abrirModalReloj('${c.id}','${r.id}')">Editar</button>
                    <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();confirmarEliminarReloj('${r.id}','${r.marca}')">✕</button>
                  </div>
                </div>
              </div>
            `).join('')
          }
        </div>
      </div>
    </div>
  `;
}

function volverAClientes() {
  clienteActivoId = null;
  document.getElementById('clientes-list-view').style.display = 'block';
  document.getElementById('clientes-detail-view').style.display = 'none';
}

function verReloj(id) {
  // Próximamente: detalle de reloj con sus reparaciones
  toast('Detalle de reloj — próximamente', '');
}

// ============================================================
// CLIENTES — MODAL
// ============================================================
function abrirModalCliente(id = null) {
  editandoClienteId = id;
  const c = id ? clientes.find(x => x.id === id) : null;
  document.getElementById('modal-cliente-title').textContent = c ? 'Editar cliente' : 'Nuevo cliente';

  document.getElementById('c-tipo').value        = c?.tipo || 'Particular';
  document.getElementById('c-nombre').value      = c?.nombre || '';
  document.getElementById('c-comercio').value    = c?.comercio || '';
  document.getElementById('c-telefono').value    = c?.telefono || '';
  document.getElementById('c-dni').value         = c?.dni || '';
  document.getElementById('c-email').value       = c?.email || '';
  document.getElementById('c-direccion').value   = c?.direccion || '';
  document.getElementById('c-anotaciones').value = c?.anotaciones || '';

  abrirModal('modal-cliente');
}

async function guardarCliente() {
  const nombre = val('c-nombre');
  if (!nombre) { toast('El nombre es obligatorio', 'error'); return; }

  const tipo      = val('c-tipo');
  const comercio  = val('c-comercio');
  const telefono  = val('c-telefono');
  const dni       = val('c-dni');
  const email     = val('c-email');
  const direccion = val('c-direccion');
  const anots     = val('c-anotaciones');
  const fecha     = hoy();

  if (editandoClienteId) {
    // Buscar fila
    const idx = clientes.findIndex(c => c.id === editandoClienteId);
    const codigo = clientes[idx].codigo;
    const row = idx + 2;
    await apiUpdate(`Clientes!A${row}:K${row}`, [
      editandoClienteId, codigo, tipo, nombre, comercio, telefono, dni, direccion, email, anots, fecha
    ]);
    clientes[idx] = { id: editandoClienteId, codigo, tipo, nombre, comercio, telefono, dni, direccion, email, anotaciones: anots, fechaMod: fecha };
    toast('Cliente actualizado', 'success');
  } else {
    const id = uid();
    const codigo = codigoCliente(tipo);
    await apiAppend('Clientes', [id, codigo, tipo, nombre, comercio, telefono, dni, direccion, email, anots, fecha]);
    clientes.push({ id, codigo, tipo, nombre, comercio, telefono, dni, direccion, email, anotaciones: anots, fechaMod: fecha });
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
  const el = document.getElementById('lista-relojes-global');
  if (!lista.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⌚</div><div class="empty-state-text">No hay relojes registrados.</div></div>`;
    return;
  }
  el.innerHTML = lista.map(r => {
    const c = clientes.find(x => x.id === r.idCliente);
    return `
    <div class="list-item">
      <div class="list-item-main">
        <div class="list-item-name">${r.marca || 'Sin marca'} ${r.modelo ? '· ' + r.modelo : ''}</div>
        <div class="list-item-sub">${r.clase} · ${r.movimiento}${r.serie ? ' · N/S: '+r.serie : ''}${c ? ' — '+c.nombre : ''}</div>
      </div>
      <div class="list-item-actions">
        <button class="btn btn-secondary btn-sm" onclick="abrirModalReloj('${r.idCliente}','${r.id}')">Editar</button>
        <button class="btn btn-danger btn-sm" onclick="confirmarEliminarReloj('${r.id}','${r.marca}')">✕</button>
      </div>
    </div>`;
  }).join('');
}

function filtrarRelojes() {
  const q = document.getElementById('search-relojes').value.toLowerCase();
  const filtrados = relojes.filter(r =>
    r.marca.toLowerCase().includes(q) ||
    r.modelo.toLowerCase().includes(q) ||
    r.referencia.toLowerCase().includes(q) ||
    r.serie.toLowerCase().includes(q)
  );
  renderizarListaRelojosGlobal(filtrados);
}

// ============================================================
// RELOJES — MODAL
// ============================================================
function abrirModalReloj(idCliente = null, idReloj = null) {
  editandoRelojId = idReloj;
  const r = idReloj ? relojes.find(x => x.id === idReloj) : null;
  document.getElementById('modal-reloj-title').textContent = r ? 'Editar reloj' : 'Nuevo reloj';

  // Selector de cliente (solo si no viene de un cliente concreto)
  const selectorCliente = document.getElementById('reloj-cliente-selector');
  const selectCliente   = document.getElementById('r-cliente');

  if (!idCliente) {
    selectorCliente.style.display = 'block';
    selectCliente.innerHTML = clientes.map(c =>
      `<option value="${c.id}" ${r?.idCliente === c.id ? 'selected' : ''}>${c.nombre}</option>`
    ).join('');
  } else {
    selectorCliente.style.display = 'none';
    selectCliente.dataset.fijo = idCliente;
  }

  document.getElementById('r-clase').value       = r?.clase || 'Pulsera';
  document.getElementById('r-movimiento').value  = r?.movimiento || 'Cuarzo';
  document.getElementById('r-marca').value       = r?.marca || '';
  document.getElementById('r-modelo').value      = r?.modelo || '';
  document.getElementById('r-referencia').value  = r?.referencia || '';
  document.getElementById('r-serie').value       = r?.serie || '';
  document.getElementById('r-color').value       = r?.colorCaja || '';
  document.getElementById('r-correa').value      = r?.materialCorrea || '';
  document.getElementById('r-anyo').value        = r?.anyoAprox || '';
  document.getElementById('r-descripcion').value = r?.descripcion || '';

  abrirModal('modal-reloj');
}

async function guardarReloj() {
  const selectorCliente = document.getElementById('reloj-cliente-selector');
  const selectCliente   = document.getElementById('r-cliente');
  const idCliente = selectorCliente.style.display === 'none'
    ? selectCliente.dataset.fijo
    : selectCliente.value;

  if (!idCliente) { toast('Selecciona un cliente', 'error'); return; }

  const clase      = val('r-clase');
  const movimiento = val('r-movimiento');
  const marca      = val('r-marca');
  const modelo     = val('r-modelo');
  const referencia = val('r-referencia');
  const serie      = val('r-serie');
  const colorCaja  = val('r-color');
  const correa     = val('r-correa');
  const anyo       = val('r-anyo');
  const desc       = val('r-descripcion');
  const estadoVis  = val('r-estado-visual');
  const fecha      = hoy();

  if (editandoRelojId) {
    const idx = relojes.findIndex(r => r.id === editandoRelojId);
    const row = idx + 2;
    await apiUpdate(`Relojes!A${row}:M${row}`, [
      editandoRelojId, idCliente, fecha, clase, movimiento, marca, modelo, referencia, serie, colorCaja, correa, anyo, desc
    ]);
    relojes[idx] = { id: editandoRelojId, idCliente, fechaAlta: fecha, clase, movimiento, marca, modelo, referencia, serie, colorCaja, materialCorrea: correa, anyoAprox: anyo, descripcion: desc };
    toast('Reloj actualizado', 'success');
  } else {
    const id = uid();
    await apiAppend('Relojes', [id, idCliente, fecha, clase, movimiento, marca, modelo, referencia, serie, colorCaja, correa, anyo, desc]);
    relojes.push({ id, idCliente, fechaAlta: fecha, clase, movimiento, marca, modelo, referencia, serie, colorCaja, materialCorrea: correa, anyoAprox: anyo, descripcion: desc });
    toast('Reloj añadido', 'success');
  }

  cerrarModal('modal-reloj');
  renderizarListaRelojosGlobal(relojes);
  if (clienteActivoId) verCliente(clienteActivoId);
}

// ============================================================
// ELIMINAR
// ============================================================
function confirmarEliminarCliente(id, nombre) {
  mostrarConfirm(
    '¿Eliminar cliente?',
    `Se eliminará a "${nombre}" y todos sus relojes asociados. Esta acción no se puede deshacer.`,
    async () => {
      await eliminarFilaPorId('Clientes', id, clientes);
      clientes = clientes.filter(c => c.id !== id);
      // Eliminar también sus relojes
      const suyos = relojes.filter(r => r.idCliente === id);
      for (const r of suyos) await eliminarFilaPorId('Relojes', r.id, relojes);
      relojes = relojes.filter(r => r.idCliente !== id);
      renderizarListaClientes(clientes);
      renderizarListaRelojosGlobal(relojes);
      if (clienteActivoId === id) volverAClientes();
      toast('Cliente eliminado', 'success');
    }
  );
}

function confirmarEliminarReloj(id, marca) {
  mostrarConfirm(
    '¿Eliminar reloj?',
    `Se eliminará el reloj "${marca || 'sin marca'}". Esta acción no se puede deshacer.`,
    async () => {
      await eliminarFilaPorId('Relojes', id, relojes);
      relojes = relojes.filter(r => r.id !== id);
      renderizarListaRelojosGlobal(relojes);
      if (clienteActivoId) verCliente(clienteActivoId);
      toast('Reloj eliminado', 'success');
    }
  );
}

async function eliminarFilaPorId(hoja, id, lista) {
  // Obtener todas las filas para encontrar el número
  const rows = await apiGet(`${hoja}!A2:A`);
  const rowIdx = rows.findIndex(r => r[0] === id);
  if (rowIdx === -1) return;
  const sheetRow = rowIdx + 2; // +1 por cabecera, +1 por base 1

  // Necesitamos el sheetId de la hoja
  const sheetIdMap = await getSheetIds();
  const sheetId = sheetIdMap[hoja];
  if (sheetId === undefined) return;

  await apiBatchUpdate([{
    deleteDimension: {
      range: { sheetId, dimension: 'ROWS', startIndex: sheetRow - 1, endIndex: sheetRow }
    }
  }]);
}

let _sheetIds = null;
async function getSheetIds() {
  if (_sheetIds) return _sheetIds;
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const d = await r.json();
  _sheetIds = {};
  for (const s of d.sheets) _sheetIds[s.properties.title] = s.properties.sheetId;
  return _sheetIds;
}

// ============================================================
// UI HELPERS
// ============================================================
function abrirModal(id) {
  document.getElementById(id).classList.add('open');
}

function cerrarModal(id) {
  document.getElementById(id).classList.remove('open');
}

let confirmCallback = null;
function mostrarConfirm(title, text, cb) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-text').textContent = text;
  confirmCallback = cb;
  document.getElementById('confirm-overlay').classList.add('open');
  document.getElementById('confirm-ok').onclick = async () => {
    cerrarConfirm();
    await cb();
  };
}
function cerrarConfirm() {
  document.getElementById('confirm-overlay').classList.remove('open');
}

function toast(msg, tipo = '') {
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// Cerrar modales al clicar fuera
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
  }
  if (e.target.id === 'confirm-overlay') cerrarConfirm();
});

// ============================================================
// REPARACIONES — DATOS
// ============================================================
let reparaciones = [];
let editandoReparacionId = null;
let reparacionActivaId   = null;
let firmaCtx = null, firmaDibujando = false;

async function cargarReparaciones() {
  const rows = await apiGet('Reparaciones!A2:M');
  reparaciones = rows.map(r => ({
    id: r[0]||'', idReloj: r[1]||'', fechaEntrada: r[2]||'',
    problema: r[3]||'', estadoVisual: r[4]||'', observaciones: r[5]||'',
    precio: r[6]||'', presupuestoAceptado: r[7]||'', estado: r[8]||'',
    fechaEstimada: r[9]||'', fechaEntregaReal: r[10]||'',
    recogeNombre: r[11]||'', recogeDni: r[12]||'',
    sinReparar: r[13]||'', motivoSinReparar: r[14]||'', firma: r[15]||''
  }));
  renderizarListaReparaciones(reparaciones);
}

// ============================================================
// REPARACIONES — HELPERS ESTADO
// ============================================================
function badgeEstado(estado) {
  const map = {
    'Pendiente de diagnóstico': 'badge-pendiente',
    'Presupuesto enviado':      'badge-presupuesto',
    'En reparación':            'badge-en-rep',
    'Esperando pieza':          'badge-pieza',
    'Lista para recoger':       'badge-lista',
    'Entregada':                'badge-entregada'
  };
  return map[estado] || 'badge-pendiente';
}

// ============================================================
// REPARACIONES — LISTA
// ============================================================
function renderizarListaReparaciones(lista) {
  const el = document.getElementById('lista-reparaciones');
  if (!lista.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔧</div><div class="empty-state-text">No hay reparaciones. ¡Añade la primera!</div></div>`;
    return;
  }
  el.innerHTML = lista.map(rep => {
    const reloj   = relojes.find(r => r.id === rep.idReloj);
    const cliente = reloj ? clientes.find(c => c.id === reloj.idCliente) : null;
    const marcaModelo = reloj ? `${reloj.marca||'Sin marca'}${reloj.modelo?' · '+reloj.modelo:''}` : '—';
    const esListaRecoger = rep.estado === 'Lista para recoger';
    return `
    <div class="list-item" onclick="verReparacion('${rep.id}')">
      <div class="list-item-main">
        <div class="list-item-name">${cliente?.nombre||'—'} — ${marcaModelo}</div>
        <div class="list-item-sub">${rep.problema?.substring(0,60)||'Sin descripción'}${rep.problema?.length>60?'...':''}</div>
        <div class="list-item-sub" style="margin-top:3px">${rep.fechaEntrada}${rep.fechaEstimada?' · Estimada: '+rep.fechaEstimada:''}</div>
      </div>
      <div class="list-item-actions">
        <span class="badge ${badgeEstado(rep.estado)}">${rep.estado}</span>
        ${esListaRecoger ? `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();abrirModalEntrega('${rep.id}')">Entregar</button>` : ''}
        <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();abrirModalReparacion(null,'${rep.id}')">Editar</button>
        <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();confirmarEliminarReparacion('${rep.id}')">✕</button>
      </div>
    </div>`;
  }).join('');
}

function filtrarReparaciones() {
  const q  = document.getElementById('search-reparaciones').value.toLowerCase();
  const st = document.getElementById('filtro-estado-rep').value;
  const filtrados = reparaciones.filter(rep => {
    const reloj   = relojes.find(r => r.id === rep.idReloj);
    const cliente = reloj ? clientes.find(c => c.id === reloj.idCliente) : null;
    const texto = [cliente?.nombre, reloj?.marca, reloj?.modelo, rep.problema].join(' ').toLowerCase();
    return texto.includes(q) && (!st || rep.estado === st);
  });
  renderizarListaReparaciones(filtrados);
}

// ============================================================
// REPARACIONES — DETALLE
// ============================================================
function verReparacion(id) {
  reparacionActivaId = id;
  const rep     = reparaciones.find(x => x.id === id);
  if (!rep) return;
  const reloj   = relojes.find(r => r.id === rep.idReloj);
  const cliente = reloj ? clientes.find(c => c.id === reloj.idCliente) : null;
  const marcaModelo = reloj ? `${reloj.marca||'Sin marca'}${reloj.modelo?' · '+reloj.modelo:''}` : '—';
  const esListaRecoger = rep.estado === 'Lista para recoger';
  const esEntregada    = rep.estado === 'Entregada';

  document.getElementById('reparaciones-list-view').style.display   = 'none';
  document.getElementById('reparaciones-detail-view').style.display = 'block';

  document.getElementById('reparaciones-detail-view').innerHTML = `
    <div class="breadcrumb">
      <span class="breadcrumb-link" onclick="volverAReparaciones()">Reparaciones</span>
      <span class="breadcrumb-sep">›</span>
      <span>${cliente?.nombre||'—'} — ${marcaModelo}</span>
    </div>
    <div class="detail-card">
      <div class="detail-header">
        <div>
          <div class="detail-header-title">${marcaModelo}</div>
          <div class="detail-header-sub">${cliente?.nombre||'—'} · Entrada: ${rep.fechaEntrada}</div>
        </div>
        <div class="detail-header-actions">
          ${esListaRecoger ? `<button class="btn-header" onclick="abrirModalEntrega('${rep.id}')">📋 Entregar</button>` : ''}
          <button class="btn-header" onclick="abrirModalReparacion(null,'${rep.id}')">✎ Editar</button>
        </div>
      </div>
      <div class="detail-body">
        <div style="margin-bottom:16px">
          <span class="badge ${badgeEstado(rep.estado)}" style="font-size:13px;padding:5px 14px">${rep.estado}</span>
          ${rep.presupuestoAceptado ? `<span class="badge" style="margin-left:8px;background:var(--bg2);color:var(--text2)">Presupuesto: ${rep.presupuestoAceptado}</span>` : ''}
        </div>
        <div class="detail-grid">
          <div class="detail-field" style="grid-column:1/-1">
            <div class="detail-field-label">Descripción del problema</div>
            <div class="detail-field-value">${rep.problema||'—'}</div>
          </div>
          ${rep.estadoVisual ? `<div class="detail-field" style="grid-column:1/-1">
            <div class="detail-field-label">Estado visual al entrar</div>
            <div class="detail-field-value">${rep.estadoVisual}</div>
          </div>` : ''}
          ${rep.observaciones ? `<div class="detail-field" style="grid-column:1/-1">
            <div class="detail-field-label">Observaciones internas</div>
            <div class="detail-field-value" style="color:var(--text2);font-style:italic">${rep.observaciones}</div>
          </div>` : ''}
          <div class="detail-field">
            <div class="detail-field-label">Presupuesto</div>
            <div class="detail-field-value mono">${rep.precio ? rep.precio+' €' : '—'}</div>
          </div>
          <div class="detail-field">
            <div class="detail-field-label">Entrega estimada</div>
            <div class="detail-field-value mono">${rep.fechaEstimada||'—'}</div>
          </div>
          ${esEntregada ? `
          <div class="detail-field">
            <div class="detail-field-label">Fecha de entrega real</div>
            <div class="detail-field-value mono">${rep.fechaEntregaReal||'—'}</div>
          </div>
          <div class="detail-field">
            <div class="detail-field-label">Recogido por</div>
            <div class="detail-field-value">${rep.recogeNombre||'—'}${rep.recogeDni?' ('+rep.recogeDni+')':''}</div>
          </div>
          ${rep.sinReparar === 'Sí' ? `<div class="detail-field" style="grid-column:1/-1">
            <div class="detail-field-label">Entregado sin reparar</div>
            <div class="detail-field-value" style="color:var(--danger)">${rep.motivoSinReparar||'Sí'}</div>
          </div>` : ''}
          ${rep.firma ? `<div class="detail-field" style="grid-column:1/-1">
            <div class="detail-field-label">Firma</div>
            <img src="${rep.firma}" style="max-width:280px;border:1px solid var(--border);border-radius:var(--radius);background:white;padding:4px">
          </div>` : ''}
          ` : ''}
        </div>
        <div class="subsection-title" style="margin-top:8px">
          Reloj
        </div>
        ${reloj ? `
        <div class="reloj-card" onclick="verCliente('${reloj.idCliente}')">
          <div class="reloj-card-main">
            <div class="reloj-card-marca">${reloj.marca||'Sin marca'}${reloj.modelo?' · '+reloj.modelo:''}</div>
            <div class="reloj-card-modelo">${reloj.movimiento} · ${reloj.clase}</div>
            ${reloj.serie ? `<div class="reloj-card-ref">N/S: ${reloj.serie}</div>` : ''}
          </div>
          <span class="reloj-clase-badge">${reloj.clase}</span>
        </div>` : '<p style="color:var(--text3);font-size:14px">Reloj no encontrado</p>'}
      </div>
    </div>`;
}

function volverAReparaciones() {
  reparacionActivaId = null;
  document.getElementById('reparaciones-list-view').style.display   = 'block';
  document.getElementById('reparaciones-detail-view').style.display = 'none';
}

// ============================================================
// REPARACIONES — MODAL
// ============================================================
function abrirModalReparacion(idRelojFijo = null, idReparacion = null) {
  editandoReparacionId = idReparacion;
  const rep = idReparacion ? reparaciones.find(x => x.id === idReparacion) : null;
  document.getElementById('modal-reparacion-title').textContent = rep ? 'Editar reparación' : 'Nueva reparación';

  // Poblar selector de clientes
  const selCliente = document.getElementById('rep-cliente');
  selCliente.innerHTML = clientes.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');

  // Si editamos, preseleccionamos el cliente del reloj
  if (rep) {
    const reloj = relojes.find(r => r.id === rep.idReloj);
    if (reloj) selCliente.value = reloj.idCliente;
  }
  actualizarRelojesSelect(rep?.idReloj || idRelojFijo);

  document.getElementById('rep-problema').value             = rep?.problema || '';
  document.getElementById('rep-estado-visual').value        = rep?.estadoVisual || '';
  document.getElementById('rep-observaciones').value        = rep?.observaciones || '';
  document.getElementById('rep-precio').value               = rep?.precio || '';
  document.getElementById('rep-presupuesto-aceptado').value = rep?.presupuestoAceptado || '';
  document.getElementById('rep-estado').value               = rep?.estado || 'Pendiente de diagnóstico';
  document.getElementById('rep-fecha-estimada').value       = rep?.fechaEstimada || '';

  abrirModal('modal-reparacion');
}

function actualizarRelojesSelect(idRelojSeleccionado = null) {
  const idCliente = document.getElementById('rep-cliente').value;
  const relojesCliente = relojes.filter(r => r.idCliente === idCliente);
  const sel = document.getElementById('rep-reloj');
  if (!relojesCliente.length) {
    sel.innerHTML = `<option value="">— Este cliente no tiene relojes —</option>`;
    return;
  }
  sel.innerHTML = relojesCliente.map(r =>
    `<option value="${r.id}" ${r.id === idRelojSeleccionado ? 'selected' : ''}>${r.marca||'Sin marca'}${r.modelo?' · '+r.modelo:''}</option>`
  ).join('');
}

async function guardarReparacion() {
  const idReloj  = document.getElementById('rep-reloj').value;
  const problema = val('rep-problema');
  if (!idReloj)  { toast('Selecciona un reloj', 'error'); return; }
  if (!problema) { toast('La descripción del problema es obligatoria', 'error'); return; }

  const estadoVisual      = val('rep-estado-visual');
  const observaciones     = val('rep-observaciones');
  const precio            = val('rep-precio');
  const presupAceptado    = val('rep-presupuesto-aceptado');
  const estado            = val('rep-estado');
  const fechaEstimada     = val('rep-fecha-estimada');
  const fechaEntrada      = editandoReparacionId ? reparaciones.find(r=>r.id===editandoReparacionId).fechaEntrada : hoy();

  if (editandoReparacionId) {
    const idx = reparaciones.findIndex(r => r.id === editandoReparacionId);
    const row = idx + 2;
    const rep = reparaciones[idx];
    await apiUpdate(`Reparaciones!A${row}:J${row}`, [
      editandoReparacionId, idReloj, fechaEntrada, problema, estadoVisual, observaciones,
      precio, presupAceptado, estado, fechaEstimada
    ]);
    reparaciones[idx] = { ...rep, idReloj, problema, estadoVisual, observaciones, precio, presupuestoAceptado: presupAceptado, estado, fechaEstimada };
    toast('Reparación actualizada', 'success');
  } else {
    const id = uid();
    await apiAppend('Reparaciones', [id, idReloj, fechaEntrada, problema, estadoVisual, observaciones, precio, presupAceptado, estado, fechaEstimada, '', '', '', '', '']);
    reparaciones.push({ id, idReloj, fechaEntrada, problema, estadoVisual, observaciones, precio, presupuestoAceptado: presupAceptado, estado, fechaEstimada, fechaEntregaReal:'', recogeNombre:'', recogeDni:'', sinReparar:'', motivoSinReparar:'', firma:'' });
    toast('Reparación creada', 'success');
  }

  cerrarModal('modal-reparacion');
  renderizarListaReparaciones(reparaciones);
  if (reparacionActivaId === editandoReparacionId) verReparacion(editandoReparacionId);
}

// ============================================================
// ENTREGA CON FIRMA
// ============================================================
let reparacionEntregaId = null;

function abrirModalEntrega(idReparacion) {
  reparacionEntregaId = idReparacion;
  const hoyStr = new Date().toISOString().split('T')[0];
  document.getElementById('ent-fecha').value          = hoyStr;
  document.getElementById('ent-sin-reparar').value    = 'No';
  document.getElementById('ent-motivo').value         = '';
  document.getElementById('ent-recoge-nombre').value  = '';
  document.getElementById('ent-recoge-dni').value     = '';
  document.getElementById('motivo-sin-reparar-grupo').style.display = 'none';

  abrirModal('modal-entrega');

  setTimeout(() => {
    iniciarFirma();
  }, 100);
}

function toggleMotivoSinReparar() {
  const val = document.getElementById('ent-sin-reparar').value;
  document.getElementById('motivo-sin-reparar-grupo').style.display = val === 'Sí' ? 'block' : 'none';
}

function iniciarFirma() {
  const canvas = document.getElementById('firma-canvas');
  if (!canvas) return;
  // Ajustar resolución al tamaño real
  const rect = canvas.getBoundingClientRect();
  canvas.width  = rect.width  * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  firmaCtx = canvas.getContext('2d');
  firmaCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
  firmaCtx.strokeStyle = '#1A1814';
  firmaCtx.lineWidth   = 2;
  firmaCtx.lineCap     = 'round';
  firmaCtx.lineJoin    = 'round';

  const getPos = (e) => {
    const r = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: src.clientX - r.left, y: src.clientY - r.top };
  };

  canvas.onmousedown  = canvas.ontouchstart = (e) => { e.preventDefault(); firmaDibujando = true; const p = getPos(e); firmaCtx.beginPath(); firmaCtx.moveTo(p.x, p.y); };
  canvas.onmousemove  = canvas.ontouchmove  = (e) => { e.preventDefault(); if (!firmaDibujando) return; const p = getPos(e); firmaCtx.lineTo(p.x, p.y); firmaCtx.stroke(); };
  canvas.onmouseup    = canvas.ontouchend   = ()  => { firmaDibujando = false; };
  canvas.onmouseleave = ()  => { firmaDibujando = false; };
}

function limpiarFirma() {
  if (!firmaCtx) return;
  const canvas = document.getElementById('firma-canvas');
  firmaCtx.clearRect(0, 0, canvas.width, canvas.height);
}

async function confirmarEntrega() {
  const canvas       = document.getElementById('firma-canvas');
  const fechaReal    = document.getElementById('ent-fecha').value;
  const recogeNombre = val('ent-recoge-nombre');
  const recogeDni    = val('ent-recoge-dni');
  const sinReparar   = val('ent-sin-reparar');
  const motivo       = val('ent-motivo');

  if (!fechaReal)    { toast('Indica la fecha de entrega', 'error'); return; }
  if (!recogeNombre) { toast('Indica quién recoge', 'error'); return; }

  // Comprobar si hay firma
  const firmaDataUrl = canvas.toDataURL('image/png');
  const firmaVacia   = !firmaCtx || esCanvasVacio(canvas);
  if (firmaVacia) { toast('Por favor recoge la firma del cliente', 'error'); return; }

  const idx = reparaciones.findIndex(r => r.id === reparacionEntregaId);
  if (idx === -1) return;
  const row = idx + 2;
  const rep = reparaciones[idx];

  // Columnas K:P (11:16) = fechaEntregaReal, recogeNombre, recogeDni, sinReparar, motivoSinReparar, firma
  await apiUpdate(`Reparaciones!A${row}:P${row}`, [
    rep.id, rep.idReloj, rep.fechaEntrada, rep.problema, rep.estadoVisual,
    rep.observaciones, rep.precio, rep.presupuestoAceptado, 'Entregada',
    rep.fechaEstimada, fechaReal, recogeNombre, recogeDni, sinReparar, motivo, firmaDataUrl
  ]);

  reparaciones[idx] = { ...rep, estado: 'Entregada', fechaEntregaReal: fechaReal, recogeNombre, recogeDni: recogeDni, sinReparar, motivoSinReparar: motivo, firma: firmaDataUrl };

  cerrarModal('modal-entrega');
  renderizarListaReparaciones(reparaciones);
  if (reparacionActivaId === reparacionEntregaId) verReparacion(reparacionEntregaId);
  toast('Entrega registrada correctamente', 'success');
}

function esCanvasVacio(canvas) {
  const ctx  = canvas.getContext('2d');
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  return !data.some(ch => ch !== 0);
}

// ============================================================
// REPARACIONES — ELIMINAR
// ============================================================
function confirmarEliminarReparacion(id) {
  mostrarConfirm(
    '¿Eliminar reparación?',
    'Se eliminará esta reparación. Esta acción no se puede deshacer.',
    async () => {
      await eliminarFilaPorId('Reparaciones', id, reparaciones);
      reparaciones = reparaciones.filter(r => r.id !== id);
      renderizarListaReparaciones(reparaciones);
      if (reparacionActivaId === id) volverAReparaciones();
      toast('Reparación eliminada', 'success');
    }
  );
}

// ============================================================
// INIT
// ============================================================
cargarGoogleScripts();
