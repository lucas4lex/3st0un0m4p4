(() => {
  const $ = (id) => document.getElementById(id);
  const canvas = $('map3d');
  const loading = $('map-loading');
  let data = null, selected = null, scene, camera, renderer, globe, brazilMesh, marker, target = {x:0.35,y:-0.9}, dragging = false, last = {x:0,y:0}, autoRotate = true;
  const params = new URLSearchParams(location.search);
  const queryUf = (params.get('uf') || params.get('estado') || '').toUpperCase();

  fetch('./info.json').then(r => { if (!r.ok) throw new Error('Não foi possível carregar info.json'); return r.json(); })
    .then(json => { data = json; $('state-count').textContent = json.states.length; renderResults(''); const initial = json.states.find(s => s.uf === queryUf) || json.states.find(s => s.uf === 'PR'); selectState(initial, false); init3D(); })
    .catch(err => { loading.textContent = 'Erro ao carregar info.json. Verifique se os arquivos estão publicados juntos.'; console.error(err); });

  function renderResults(term) {
    const list = $('search-results'); list.innerHTML = '';
    const normalized = term.trim().toLocaleLowerCase('pt-BR');
    const matches = data.states.filter(s => !normalized || [s.name,s.uf,s.capital,s.region].some(v => v.toLocaleLowerCase('pt-BR').includes(normalized))).slice(0,7);
    matches.forEach(s => {
      const b = document.createElement('button'); b.className = 'result' + (selected && selected.uf === s.uf ? ' selected' : '');
      b.innerHTML = `<span>${s.name} <small>(${s.uf})</small></span><small>${s.capital} ↗</small>`;
      b.addEventListener('click', () => { selectState(s, true); $('search-input').value = ''; renderResults(''); }); list.appendChild(b);
    });
    if (!matches.length) list.innerHTML = '<span style="padding:8px;color:#8ea2ba;font-size:11px">Nenhum estado encontrado.</span>';
  }
  function selectState(s, updateUrl) {
    if (!s) return; selected = s;
    $('detail-flag').textContent = '🇧🇷'; $('detail-region').textContent = s.region.toUpperCase();
    $('detail-name').textContent = s.name; $('detail-description').textContent = s.description;
    $('detail-capital').textContent = s.capital; $('detail-region-name').textContent = s.region;
    if (updateUrl) history.replaceState({}, '', `${location.pathname}?uf=${encodeURIComponent(s.uf)}`);
    renderResults($('search-input').value);
    if (marker && camera) focusState(s);
  }
  $('search-input').addEventListener('input', e => renderResults(e.target.value));
  $('search-input').addEventListener('keydown', e => { if(e.key === 'Enter'){ const first = data.states.find(s => [s.name,s.uf,s.capital].some(v => v.toLowerCase() === e.target.value.trim().toLowerCase())); if(first) selectState(first,true); }});
  document.addEventListener('keydown', e => { if(e.key === '/' && document.activeElement.tagName !== 'INPUT'){e.preventDefault();$('search-input').focus();} });
  $('focus-map').addEventListener('click', () => selected && focusState(selected));
  $('reset-view').addEventListener('click', () => { target = {x:0.35,y:-0.9}; camera.position.set(0,0,3.15); camera.lookAt(0,0,0); });
  $('spin-toggle').addEventListener('click', () => { autoRotate = !autoRotate; $('spin-toggle').classList.toggle('active', autoRotate); });

  function latLon(lat, lon, radius) {
    const phi = (90-lat)*Math.PI/180, theta = (lon+180)*Math.PI/180;
    return new THREE.Vector3(-radius*Math.sin(phi)*Math.cos(theta), radius*Math.cos(phi), radius*Math.sin(phi)*Math.sin(theta));
  }
  function focusState(s) {
    const p = latLon(s.lat, s.lon, 1);
    target.y = Math.atan2(p.x, p.z);
    target.x = Math.asin(p.y);
    if (marker) { marker.position.copy(p.clone().multiplyScalar(1.018)); marker.visible = true; }
  }
  function init3D() {
    try {
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(38, canvas.clientWidth/canvas.clientHeight, 0.1, 100);
      camera.position.set(0,0,3.15);
      renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:true});
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      scene.add(new THREE.AmbientLight(0x9ebbd8, 2.1));
      const light = new THREE.DirectionalLight(0xffffff, 2.3); light.position.set(-3,2,4); scene.add(light);
      const group = new THREE.Group(); scene.add(group); globe = group;
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(1,64,48), new THREE.MeshStandardMaterial({color:0x172f47, roughness:.82, metalness:.08}));
      group.add(sphere);
      // Linhas sutis de latitude/longitude dão textura ao globo sem depender de imagens externas.
      const gridMat = new THREE.LineBasicMaterial({color:0x3b5d77, transparent:true, opacity:.32});
      for(let lat=-60;lat<=60;lat+=20){ const pts=[]; for(let lon=0;lon<=360;lon+=3) pts.push(latLon(lat,lon,1.003)); group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),gridMat)); }
      for(let lon=0;lon<360;lon+=20){const pts=[];for(let lat=-89;lat<=89;lat+=3)pts.push(latLon(lat,lon,1.003));group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),gridMat));}
      // Silhueta aproximada do Brasil projetada sobre a esfera.
      const outline=[[-5,-74],[2,-69],[5,-60],[4,-51],[1,-48],[-5,-35],[-11,-37],[-16,-39],[-22,-42],[-24,-48],[-33,-53],[-29,-57],[-20,-58],[-16,-61],[-10,-65],[-5,-74]];
      const shape = new THREE.Shape(); outline.forEach(([lat,lon],i)=>{const x=(lon+74)*Math.cos(-12*Math.PI/180), y=-lat; if(i===0)shape.moveTo(x,y);else shape.lineTo(x,y);}); shape.closePath();
      const geo = new THREE.ShapeGeometry(shape,16);
      const pos = geo.attributes.position;
      for(let i=0;i<pos.count;i++){const lon=pos.getX(i)/Math.cos(-12*Math.PI/180)-74, lat=-pos.getY(i); const v=latLon(lat,lon,1.009); pos.setXYZ(i,v.x,v.y,v.z);}
      geo.computeVertexNormals();
      brazilMesh = new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:0x54e6cf, side:THREE.DoubleSide, transparent:true, opacity:.86, depthWrite:false}));
      group.add(brazilMesh);
      // Pontos de capitais
      const dotGeo = new THREE.SphereGeometry(.012,12,8);
      data.states.forEach(s=>{const dot=new THREE.Mesh(dotGeo,new THREE.MeshBasicMaterial({color:0xffcb70}));dot.position.copy(latLon(s.lat,s.lon,1.018));dot.userData.state=s;group.add(dot);});
      marker = new THREE.Mesh(new THREE.SphereGeometry(.025,16,12),new THREE.MeshBasicMaterial({color:0xffffff}));
      const glow = new THREE.Mesh(new THREE.SphereGeometry(.045,16,12),new THREE.MeshBasicMaterial({color:0x54e6cf,transparent:true,opacity:.25}));
      marker.add(glow);group.add(marker);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.04,.003,8,40),new THREE.MeshBasicMaterial({color:0x54e6cf})); marker.add(ring); ring.rotation.x=.4;
      const dragStart = e => {dragging=true;last={x:e.clientX,y:e.clientY};canvas.setPointerCapture?.(e.pointerId);};
      canvas.addEventListener('pointerdown',dragStart);
      canvas.addEventListener('pointermove',e=>{if(!dragging)return;const dx=e.clientX-last.x,dy=e.clientY-last.y;last={x:e.clientX,y:e.clientY};target.y+=dx*.006;target.x=Math.max(-1.3,Math.min(1.3,target.x+dy*.006));autoRotate=false;$('spin-toggle').classList.remove('active');});
      canvas.addEventListener('pointerup',()=>dragging=false);canvas.addEventListener('pointercancel',()=>dragging=false);
      canvas.addEventListener('wheel',e=>{e.preventDefault();camera.position.z=Math.max(1.8,Math.min(4.2,camera.position.z+e.deltaY*.002));},{passive:false});
      window.addEventListener('resize',resize);
      loading.classList.add('hidden'); focusState(selected);
      const clock = new THREE.Clock();
      function animate(){requestAnimationFrame(animate);const t=clock.getDelta();if(autoRotate&&!dragging)target.y+=t*.12;globe.rotation.y += (target.y-globe.rotation.y)*.055;globe.rotation.x += (target.x-globe.rotation.x)*.055;marker.rotation.y-=t*.8;renderer.render(scene,camera);}
      animate();
    } catch(e) { loading.textContent='Seu navegador não conseguiu iniciar o mapa 3D.'; console.error(e); }
  }
  function resize(){if(!renderer||!camera)return;const w=canvas.clientWidth,h=canvas.clientHeight;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);}
})();