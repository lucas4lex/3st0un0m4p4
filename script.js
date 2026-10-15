fetch('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js');

const $ = (selector) => document.querySelector(selector);
const UF_NAMES = {
  AC:'Acre',AL:'Alagoas',AP:'Amapá',AM:'Amazonas',BA:'Bahia',CE:'Ceará',DF:'Distrito Federal',
  ES:'Espírito Santo',GO:'Goiás',MA:'Maranhão',MT:'Mato Grosso',MS:'Mato Grosso do Sul',
  MG:'Minas Gerais',PA:'Pará',PB:'Paraíba',PR:'Paraná',PE:'Pernambuco',PI:'Piauí',
  RJ:'Rio de Janeiro',RN:'Rio Grande do Norte',RS:'Rio Grande do Sul',RO:'Rondônia',
  RR:'Roraima',SC:'Santa Catarina',SP:'São Paulo',SE:'Sergipe',TO:'Tocantins'
};
const UF_CENTERS = {
  AC:[-67.81,-9.97],AL:[-35.71,-9.65],AP:[-51.07,.03],AM:[-60.02,-3.1],BA:[-38.5,-12.97],
  CE:[-38.52,-3.73],DF:[-47.88,-15.79],ES:[-40.34,-20.32],GO:[-49.25,-16.68],MA:[-44.3,-2.53],
  MT:[-56.1,-15.6],MS:[-54.65,-20.44],MG:[-43.94,-19.92],PA:[-48.5,-1.45],PB:[-34.86,-7.12],
  PR:[-49.27,-25.43],PE:[-34.9,-8.05],PI:[-42.8,-5.09],RJ:[-43.2,-22.91],RN:[-35.21,-5.79],
  RS:[-51.23,-30.03],RO:[-63.9,-8.76],RR:[-60.67,2.82],SC:[-48.55,-27.59],
  SP:[-46.63,-23.55],SE:[-37.07,-10.91],TO:[-48.33,-10.18]
};
const GEO_URL = 'https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/brazil-states.geojson';
const LOCAL_KEY = '3st0un0m4p4:v1';
let config = null, people = [], scene, camera, renderer, controlsTarget, raycaster, pointer;
let houseMeshes = [], selectedId = null, hovered = null, mapReady = false;
let animationFrame = 0, drag = false, lastPointer = {x:0,y:0}, rotation = {x:0.42,y:-0.22}, zoom = 1;
let canvasHost, tooltip, currentFilters = {uf:'', cidade:'', buscar:'', pessoa:''};

function slugify(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
}
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function houseLevel(person) { return Math.max(1, Math.floor(Math.max(0, Number(person.votos)||0) / 5) + 1); }
function houseScale(person) { return 0.52 + Math.min(houseLevel(person), 12) * 0.075; }
function getLocalData() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); } catch { return {}; }
}
function saveLocalData(data) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(data)); } catch { showMessage('Não foi possível salvar neste navegador.'); }
}
function mergeLocalData() {
  const local = getLocalData();
  people = (config.participantes || []).filter(p => p.visivel !== false).map(p => ({...p}));
  if (Array.isArray(local.people)) {
    for (const p of local.people) if (!people.some(base => base.id === p.id)) people.push(p);
  }
  for (const p of people) {
    if (local.votes && Number.isFinite(local.votes[p.id])) p.votos = Math.max(Number(p.votos)||0, local.votes[p.id]);
  }
}
function showMessage(message, error=false) {
  const el = $('#mensagem');
  if (!el) return;
  el.textContent = message;
  el.style.color = error ? '#ff9cae' : 'var(--cyan)';
}
function getUF(person) { return String(person.uf || '').toUpperCase(); }
function getCity(person) { return String(person.cidade || '').trim(); }
function matchesFilters(person) {
  if (currentFilters.uf && getUF(person) !== currentFilters.uf) return false;
  if (currentFilters.cidade && slugify(getCity(person)) !== slugify(currentFilters.cidade)) return false;
  const q = currentFilters.buscar.toLocaleLowerCase('pt-BR');
  if (q && ![person.nome, person.cidade, person.estado, person.uf].some(v => String(v||'').toLocaleLowerCase('pt-BR').includes(q))) return false;
  return true;
}
function readQuery() {
  const params = new URLSearchParams(location.search);
  currentFilters.uf = (params.get('uf') || '').toUpperCase();
  currentFilters.cidade = params.get('cidade') || '';
  currentFilters.buscar = params.get('buscar') || '';
  currentFilters.pessoa = params.get('pessoa') || '';
  if ($('#campoBusca')) $('#campoBusca').value = currentFilters.buscar;
}
function updateQuery(patch={}) {
  const params = new URLSearchParams(location.search);
  for (const [key,value] of Object.entries(patch)) {
    if (value) params.set(key, value); else params.delete(key);
  }
  const query = params.toString();
  history.replaceState(null, '', location.pathname + (query ? '?' + query : '') + location.hash);
}
function fillStateSelects() {
  const options = Object.keys(UF_NAMES).sort((a,b)=>UF_NAMES[a].localeCompare(UF_NAMES[b],'pt-BR'));
  const rankingSelect = $('#filtroEstado'), ufSelect = $('#uf');
  options.forEach(uf => {
    const option = new Option(`${uf} — ${UF_NAMES[uf]}`, uf);
    rankingSelect.add(option);
    ufSelect.add(new Option(uf, uf));
  });
  if (currentFilters.uf && UF_NAMES[currentFilters.uf]) rankingSelect.value = currentFilters.uf;
}
function renderStats() {
  $('#totalPessoas').textContent = people.length.toLocaleString('pt-BR');
  $('#totalCidades').textContent = new Set(people.map(p=>slugify(p.cidade))).size.toLocaleString('pt-BR');
  $('#totalVotos').textContent = people.reduce((sum,p)=>sum+(Number(p.votos)||0),0).toLocaleString('pt-BR');
  $('#heroLevel').textContent = String(Math.max(1,...people.map(houseLevel))).padStart(2,'0');
}
function renderDetails(person) {
  const box = $('#detalhesCasa');
  if (!person) {
    $('#painelTitulo').textContent = 'Explore o mapa';
    box.className = 'house-details empty-details';
    box.innerHTML = '<div class="empty-icon">⌖</div><p>Selecione uma casa no mapa ou escolha alguém no ranking para ver seu nível e votar.</p>';
    return;
  }
  $('#painelTitulo').textContent = 'Casa selecionada';
  box.className = 'house-details';
  const votes = Number(person.votos)||0;
  const level = houseLevel(person);
  const alreadyVoted = Boolean(getLocalData().voted && getLocalData().voted[person.id]);
  box.innerHTML = `<h3 class="detail-name">${esc(person.nome)}</h3><div class="detail-location">📍 ${esc(person.cidade)}, ${esc(person.uf)}</div><p class="detail-desc">${esc(person.descricao || 'Esta casa está no mapa. Ajude-a a crescer!')}</p><div class="detail-stats"><div><strong>${votes}</strong><span>votos</span></div><div><strong>Nível ${level}</strong><span>da casa</span></div><div><strong>${votes ? Math.round(votes / Math.max(1,people.reduce((s,p)=>s+(Number(p.votos)||0),0))*100) : 0}%</strong><span>dos votos</span></div></div><button class="vote-button" id="votarCasa" ${alreadyVoted?'disabled':''}>${alreadyVoted?'✓ Você já votou nesta casa':'♡ Votar nesta casa (+1)'}</button>`;
  $('#votarCasa').addEventListener('click', () => voteFor(person.id));
}
function renderMiniList(list) {
  const host = $('#listaPessoas');
  host.innerHTML = '';
  list.slice(0,5).forEach(p => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'mini-person';
    button.innerHTML = `<span class="avatar">${esc((p.nome||'?').slice(0,1).toUpperCase())}</span><span class="mini-person-copy"><strong>${esc(p.nome)}</strong><span>${esc(p.cidade)} · ${esc(p.uf)}</span></span><span class="mini-level">N${houseLevel(p)}</span>`;
    button.addEventListener('click', () => selectPerson(p.id, true));
    host.appendChild(button);
  });
}
function renderRanking() {
  const uf = $('#filtroEstado').value;
  const order = $('#filtroOrdenacao').value;
  let list = people.filter(matchesFilters);
  if (uf) list = list.filter(p=>getUF(p)===uf);
  list.sort((a,b) => order==='nome' ? a.nome.localeCompare(b.nome,'pt-BR') : order==='nivel' ? houseLevel(b)-houseLevel(a) || b.votos-a.votos : (Number(b.votos)||0)-(Number(a.votos)||0));
  $('#contadorResultados').textContent = list.length;
  $('#rankingVazio').hidden = list.length > 0;
  $('#ranking').innerHTML = list.map((p,i)=>`<button class="rank-card" type="button" data-person="${esc(p.id)}"><span class="rank-pos">${String(i+1).padStart(2,'0')}</span><span class="rank-avatar">${i===0?'👑':'🏠'}</span><span class="rank-main"><strong>${esc(p.nome)}</strong><span>${esc(p.cidade)} · ${esc(p.uf)} · Nível ${houseLevel(p)}</span></span><span class="rank-score"><strong>${Number(p.votos)||0}</strong><span>votos</span></span></button>`).join('');
  $('#ranking').querySelectorAll('[data-person]').forEach(el=>el.addEventListener('click',()=>{selectPerson(el.dataset.person,true);$('#mapa-section').scrollIntoView({behavior:'smooth'});}));
  renderMiniList(list);
}
function voteFor(id) {
  const local = getLocalData();
  local.voted ||= {};
  local.votes ||= {};
  if (local.voted[id]) { showMessage('Você já votou nesta casa neste navegador.'); return; }
  const person = people.find(p=>p.id===id);
  if (!person) return;
  local.voted[id] = true;
  local.votes[id] = (Number(person.votos)||0) + 1;
  saveLocalData(local);
  person.votos = local.votes[id];
  renderAll(); selectPerson(id,false);
  showMessage(`Voto registrado para ${person.nome}! A casa agora está no nível ${houseLevel(person)}.`);
}
function createHouseMesh(person, position) {
  const group = new THREE.Group();
  const level = houseLevel(person);
  const scale = houseScale(person);
  const bodyMat = new THREE.MeshStandardMaterial({color:0x9d86ff,roughness:.55,metalness:.08});
  const sideMat = new THREE.MeshStandardMaterial({color:0x5f4ab3,roughness:.6});
  const roofMat = new THREE.MeshStandardMaterial({color:0x65e6db,roughness:.4});
  const body = new THREE.Mesh(new THREE.BoxGeometry(.72*scale,.5*scale,.62*scale), bodyMat);
  body.position.y=.28*scale; group.add(body);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(.58*scale,.42*scale,4),roofMat);
  roof.rotation.y=Math.PI/4; roof.position.y=.72*scale; group.add(roof);
  const door = new THREE.Mesh(new THREE.BoxGeometry(.13*scale,.25*scale,.035*scale),sideMat);
  door.position.set(0,.13*scale,.32*scale); group.add(door);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(.48*scale,.48*scale,.045,24),new THREE.MeshStandardMaterial({color:0x293557,roughness:.7}));
  base.position.y=.025; group.add(base);
  group.position.set(position.x,position.y,position.z);
  group.userData.personId=person.id;
  group.userData.label=person.nome;
  group.userData.bodyMat=bodyMat;
  group.userData.roofMat=roofMat;
  group.userData.defaultScale=1;
  group.scale.setScalar(1);
  return group;
}
function project(lon,lat) {
  return {x:(lon+74)*.27, z:(lat+34)*-.27};
}
function featurePolygons(geometry) {
  if (!geometry) return [];
  if (geometry.type==='Polygon') return geometry.coordinates;
  if (geometry.type==='MultiPolygon') return geometry.coordinates.flat();
  return [];
}
function addGeoJSON(geo) {
  const material = new THREE.MeshStandardMaterial({color:0x202b4a,roughness:.85,metalness:.03,side:THREE.DoubleSide});
  const edgeMat = new THREE.LineBasicMaterial({color:0x5b6a94,transparent:true,opacity:.7});
  const allPoints=[];
  for (const feature of (geo.features||[])) {
    const polygons=featurePolygons(feature.geometry);
    for (const polygon of polygons) {
      const ring=polygon[0];
      if (!ring || ring.length<3) continue;
      const shape=new THREE.Shape();
      ring.forEach((coord,i)=>{
        const p=project(coord[0],coord[1]); allPoints.push(p);
        if(i===0) shape.moveTo(p.x,p.z); else shape.lineTo(p.x,p.z);
      });
      shape.closePath();
      const mesh=new THREE.Mesh(new THREE.ShapeGeometry(shape),material);
      mesh.rotation.x=-Math.PI/2; mesh.position.y=.02; scene.add(mesh);
      const pts=ring.map(c=>{const p=project(c[0],c[1]);return new THREE.Vector3(p.x,.055,p.z);});
      const line=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts),edgeMat);
      scene.add(line);
    }
  }
  if(allPoints.length){
    const xs=allPoints.map(p=>p.x), zs=allPoints.map(p=>p.z);
    const centerX=(Math.min(...xs)+Math.max(...xs))/2, centerZ=(Math.min(...zs)+Math.max(...zs))/2;
    scene.userData.mapCenter={x:centerX,z:centerZ};
  }
}
function buildMapFallback() {
  // Silhueta aproximada, usada se o GeoJSON externo estiver indisponível.
  const pts=[[-73,-7],[-70,2],[-61,5],[-52,4],[-44,1],[-35,-5],[-38,-13],[-40,-20],[-48,-29],[-54,-33],[-58,-25],[-66,-20],[-70,-10]];
  const shape=new THREE.Shape();
  pts.forEach((c,i)=>{const p=project(c[0],c[1]);if(i===0)shape.moveTo(p.x,p.z);else shape.lineTo(p.x,p.z);});
  shape.closePath();
  const mesh=new THREE.Mesh(new THREE.ShapeGeometry(shape),new THREE.MeshStandardMaterial({color:0x202b4a,side:THREE.DoubleSide}));
  mesh.rotation.x=-Math.PI/2; mesh.position.y=.02; scene.add(mesh);
  const linePts=pts.map(c=>{const p=project(c[0],c[1]);return new THREE.Vector3(p.x,.06,p.z);});
  scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(linePts),new THREE.LineBasicMaterial({color:0x5b6a94})));
}
function rebuildHouses() {
  houseMeshes.forEach(mesh=>scene.remove(mesh)); houseMeshes=[];
  const visible=people.filter(matchesFilters);
  visible.forEach(person=>{
    const [lon,lat]=Number.isFinite(Number(person.longitude))&&Number.isFinite(Number(person.latitude))?[Number(person.longitude),Number(person.latitude)]:(UF_CENTERS[getUF(person)]||[-51,-10]);
    const p=project(lon,lat);
    // Slight offsets keep houses in the same city from occupying exactly the same point.
    const sameCity=visible.filter(other=>slugify(other.cidade)===slugify(person.cidade));
    const index=sameCity.findIndex(other=>other.id===person.id);
    const angle=index*2.399;
    const offset=Math.floor(index/8)*.28;
    const pos={x:p.x+Math.cos(angle)*(.22+offset),y:.09,z:p.z+Math.sin(angle)*(.22+offset)};
    const house=createHouseMesh(person,pos);
    if(person.id===selectedId) house.children.forEach(child=>{if(child.material&&child.material.color)child.material.color.setHex(0x65e6db);});
    scene.add(house); houseMeshes.push(house);
  });
}
function initThree() {
  canvasHost=$('#mapa');
  scene=new THREE.Scene(); scene.background=new THREE.Color(0x0c1121);
  scene.fog=new THREE.Fog(0x0c1121,15,36);
  const width=canvasHost.clientWidth||800,height=canvasHost.clientHeight||480;
  camera=new THREE.PerspectiveCamera(42,width/height,.1,100);
  camera.position.set(0,8,15);
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,2)); renderer.setSize(width,height);
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  canvasHost.appendChild(renderer.domElement);
  scene.add(new THREE.AmbientLight(0xb9c9ff,2));
  const key=new THREE.DirectionalLight(0xffffff,2.5);key.position.set(-4,10,8);scene.add(key);
  const rim=new THREE.PointLight(0x7664ff,22,30);rim.position.set(3,5,-4);scene.add(rim);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(45,45),new THREE.MeshStandardMaterial({color:0x0d1428,roughness:1}));
  ground.rotation.x=-Math.PI/2;ground.position.y=-.12;scene.add(ground);
  raycaster=new THREE.Raycaster();pointer=new THREE.Vector2();
  renderer.domElement.addEventListener('pointerdown',onPointerDown);
  renderer.domElement.addEventListener('pointermove',onPointerMove);
  renderer.domElement.addEventListener('pointerup',()=>{drag=false;});
  renderer.domElement.addEventListener('pointerleave',()=>{drag=false;tooltip.hidden=true;});
  renderer.domElement.addEventListener('wheel',onWheel,{passive:false});
  $('#resetCamera').addEventListener('click',()=>{rotation={x:.42,y:-.22};zoom=1;});
  window.addEventListener('resize',resizeMap);
  animate();
}
function onPointerDown(event) {
  drag=true;lastPointer={x:event.clientX,y:event.clientY};
  renderer.domElement.setPointerCapture?.(event.pointerId);
}
function onPointerMove(event) {
  if(drag && event.buttons){
    const dx=event.clientX-lastPointer.x,dy=event.clientY-lastPointer.y;
    rotation.y+=dx*.006;rotation.x=Math.max(-.9,Math.min(1.1,rotation.x+dy*.004));
    lastPointer={x:event.clientX,y:event.clientY};
    tooltip.hidden=true;return;
  }
  const rect=renderer.domElement.getBoundingClientRect();
  pointer.x=((event.clientX-rect.left)/rect.width)*2-1;
  pointer.y=-((event.clientY-rect.top)/rect.height)*2+1;
  raycaster.setFromCamera(pointer,camera);
  const hits=raycaster.intersectObjects(houseMeshes,true);
  let mesh=null;
  if(hits.length) {
    let obj=hits[0].object;
    while(obj && !obj.userData.personId) obj=obj.parent;
    mesh=obj||null;
  }
  if(mesh){
    const person=people.find(p=>p.id===mesh.userData.personId);
    if(person){tooltip.hidden=false;tooltip.textContent=`🏠 ${person.nome} · ${person.cidade} · Nível ${houseLevel(person)}`;tooltip.style.left=`${event.clientX+12}px`;tooltip.style.top=`${event.clientY+12}px`;}
    renderer.domElement.style.cursor='pointer';hovered=mesh;
  }else{tooltip.hidden=true;renderer.domElement.style.cursor=drag?'grabbing':'grab';hovered=null;}
}
function onWheel(event){event.preventDefault();zoom=Math.max(.65,Math.min(1.8,zoom+(event.deltaY>0?-.08:.08)));}
function resizeMap(){
  if(!renderer||!camera)return;
  const width=canvasHost.clientWidth||800,height=canvasHost.clientHeight||480;
  camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height);
}
function animate(){
  animationFrame=requestAnimationFrame(animate);
  if(!renderer)return;
  const center=scene.userData.mapCenter||{x:0,z:0};
  const distance=15/zoom;
  camera.position.set(center.x+Math.sin(rotation.y)*distance,Math.max(4,Math.cos(rotation.x)*distance*.75),center.z+Math.cos(rotation.y)*distance);
  camera.lookAt(center.x,0,center.z);
  houseMeshes.forEach(mesh=>{const active=mesh.userData.personId===selectedId;const pulse=active?1+Math.sin(performance.now()*.004)*.035:1;mesh.scale.setScalar(pulse);});
  renderer.render(scene,camera);
}
function selectPerson(id, focus) {
  selectedId=id;
  const person=people.find(p=>p.id===id);
  if(!person)return;
  renderDetails(person);rebuildHouses();
  if(focus){rotation={x:.35,y:-.22};}
  updateQuery({pessoa:slugify(person.nome)+'-'+person.id});
}
function renderAll(){
  renderStats();renderRanking();rebuildHouses();
}
async function loadMap() {
  try{
    const response=await fetch(GEO_URL);
    if(!response.ok)throw new Error('GeoJSON indisponível');
    const geo=await response.json();addGeoJSON(geo);
  }catch(error){
    console.warn('Não foi possível carregar os limites dos estados; usando silhueta simplificada.',error);
    buildMapFallback();
    showMessage('Mapa em modo simplificado: não foi possível carregar os limites estaduais.');
  }
  rebuildHouses();
  $('#mapaCarregando').hidden=true;mapReady=true;
}
function setupEvents(){
  $('#formBusca').addEventListener('submit',event=>{
    event.preventDefault();
    currentFilters.buscar=$('#campoBusca').value.trim();
    updateQuery({buscar:currentFilters.buscar});
    renderAll();
    const first=people.filter(matchesFilters)[0];
    if(first)selectPerson(first.id,false);
    else showMessage('Nenhuma casa encontrada para essa busca.',true);
  });
  $('#campoBusca').addEventListener('input',()=>{
    if(!$('#campoBusca').value.trim()){
      currentFilters.buscar='';updateQuery({buscar:''});renderAll();
    }
  });
  $('#filtroEstado').addEventListener('change',()=>{
    currentFilters.uf=$('#filtroEstado').value;
    updateQuery({uf:currentFilters.uf});renderAll();
  });
  $('#filtroOrdenacao').addEventListener('change',renderRanking);
  $('#formEntrar').addEventListener('submit',event=>{
    event.preventDefault();
    const name=$('#nome').value.trim(),city=$('#cidade').value.trim(),uf=$('#uf').value;
    if(!name||!city||!uf){showMessage('Preencha nome, cidade e estado.',true);return;}
    const local=getLocalData();local.people ||= [];
    const existing=[...people,...local.people].find(p=>slugify(p.nome)===slugify(name)&&slugify(p.cidade)===slugify(city)&&p.uf===uf);
    if(existing){showMessage('Já existe uma casa com esse nome nessa cidade.',true);return;}
    const center=UF_CENTERS[uf]||[-51,-10];
    const person={
      id:'casa-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7),
      nome:name,cidade:city,estado:UF_NAMES[uf],uf,
      longitude:center[0]+(Math.random()-.5)*.45,latitude:center[1]+(Math.random()-.5)*.35,
      descricao:$('#descricao').value.trim()||'Minha casa acabou de entrar no mapa!',
      votos:0,categoria:'participante',visivel:true
    };
    local.people.push(person);saveLocalData(local);mergeLocalData();
    currentFilters={uf:'',cidade:'',buscar:'',pessoa:person.id};
    $('#campoBusca').value='';$('#filtroEstado').value='';
    updateQuery({uf:'',cidade:'',buscar:'',pessoa:slugify(person.nome)+'-'+person.id});
    renderAll();selectPerson(person.id,true);
    $('#formEntrar').reset();
    showMessage(`Casa criada! Bem-vindo ao mapa, ${person.nome}.`);
    $('#mapa-section').scrollIntoView({behavior:'smooth'});
  });
}
function applyInitialPerson() {
  if(!currentFilters.pessoa)return;
  let person=people.find(p=>p.id===currentFilters.pessoa);
  if(!person)person=people.find(p=>(slugify(p.nome)+'-'+p.id)===currentFilters.pessoa);
  if(!person)person=people.find(p=>slugify(p.nome)===slugify(currentFilters.pessoa));
  if(person)selectPerson(person.id,false);
}
async function init(){
  tooltip=$('#tooltipMapa');
  readQuery();
  try{
    const response=await fetch('info.json',{cache:'no-store'});
    if(!response.ok)throw new Error('Não foi possível abrir info.json');
    config=await response.json();
  }catch(error){
    console.error(error);
    $('#mapaCarregando').innerHTML='<strong>Não foi possível carregar info.json</strong><span>Abra o projeto por um servidor local (localhost), não por file://.</span>';
    showMessage('Verifique se info.json está na mesma pasta de index.html.',true);
    return;
  }
  fillStateSelects();mergeLocalData();initThree();setupEvents();renderAll();
  await loadMap();
  applyInitialPerson();
  if(currentFilters.cidade||currentFilters.uf||currentFilters.buscar)renderAll();
}
init().catch(error=>{console.error(error);showMessage('Ocorreu um erro ao iniciar o mapa. Abra o console para detalhes.',true);});
