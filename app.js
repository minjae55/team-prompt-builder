// ====================== STORAGE KEYS ======================
const WS_LIST_KEY    = 'tp_workspaces';       // 내 워크스페이스 목록 (local)
const WS_CURRENT_KEY = 'tp_current_ws';       // 현재 선택된 ws id (local)
const VIEW_BUILDER_KEY = 'team_prompt_view_builder';

// 워크스페이스 ID 기반 키 생성
function wsSharedKey(wsId)   { return `tp_shared_${wsId}`; }
function wsPersonalKey(wsId) { return `tp_personal_${wsId}`; }
function wsSelectedKey(wsId) { return `tp_selected_${wsId}`; }
function wsCustomKey(wsId)   { return `tp_custom_${wsId}`; }

// ====================== WORKSPACE STATE ======================
let currentWs = null;  // { id, name, type:'team'|'solo', code? }
let wsNewType = 'team';

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = n => Array.from({length:n}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  return `${seg(3)}-${seg(4)}`;
}

function regenCode() {
  document.getElementById('ws-new-code').value = genCode();
}

function selectWsType(type) {
  wsNewType = type;
  document.getElementById('wstype-team').className = `ws-type-btn team${type==='team'?' selected':''}`;
  document.getElementById('wstype-solo').className = `ws-type-btn solo${type==='solo'?' selected':''}`;
  document.getElementById('ws-code-field').style.display = type === 'team' ? '' : 'none';
}

function switchWsTab(tab) {
  ['list','new','join'].forEach(t => {
    document.getElementById(`ws-tab-${t}`).style.display = t===tab ? '' : 'none';
    document.getElementById(`tab-${t}`).classList.toggle('active', t===tab);
  });
  if (tab === 'new' && !document.getElementById('ws-new-code').value) {
    document.getElementById('ws-new-code').value = genCode();
  }
}

// ── 내 워크스페이스 목록 로드
function loadWsList() {
  try {
    const raw = localStorage.getItem(WS_LIST_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch(e) { return []; }
}
function saveWsList(list) {
  try { localStorage.setItem(WS_LIST_KEY, JSON.stringify(list)); } catch(e) {}
}

// ── 워크스페이스 만들기
function createWorkspace() {
  const name = document.getElementById('ws-new-name').value.trim();
  if (!name) {
    const el = document.getElementById('ws-new-name');
    el.focus(); el.style.borderColor = 'var(--red)';
    setTimeout(() => el.style.borderColor = '', 1500); return;
  }
  const code = wsNewType === 'team' ? document.getElementById('ws-new-code').value.trim() : null;
  // 팀방 ID = 코드 기반 (같은 코드 = 같은 방), 개인방 = 랜컵
  const id = wsNewType === 'team' ? `team_${code.replace('-','')}` : `solo_${Date.now()}`;
  const ws = { id, name, type: wsNewType, code, createdAt: Date.now() };

  const list = loadWsList();
  // 이미 같은 id가 있으면 업데이트
  const idx = list.findIndex(w => w.id === id);
  if (idx >= 0) list[idx] = ws; else list.unshift(ws);
  saveWsList(list);

  enterWorkspace(ws);
}

// ── 초대코드로 입장
function joinWorkspace() {
  const rawCode = document.getElementById('ws-join-code').value.trim().toUpperCase();
  const name    = document.getElementById('ws-join-name').value.trim();
  if (!rawCode || !name) {
    const el = !rawCode ? document.getElementById('ws-join-code') : document.getElementById('ws-join-name');
    el.focus(); el.style.borderColor = 'var(--red)';
    setTimeout(() => el.style.borderColor = '', 1500); return;
  }
  const code = rawCode.includes('-') ? rawCode : `${rawCode.slice(0,3)}-${rawCode.slice(3)}`;
  const id   = `team_${code.replace('-','')}`;
  const ws   = { id, name, type: 'team', code, createdAt: Date.now() };

  const list = loadWsList();
  const idx  = list.findIndex(w => w.id === id);
  if (idx >= 0) list[idx].name = name; else list.unshift(ws);
  saveWsList(list);

  enterWorkspace(ws);
}

// ── 워크스페이스 입장
function enterWorkspace(ws) {
  currentWs = ws;
  try { localStorage.setItem(WS_CURRENT_KEY, ws.id); } catch(e) {}
  closeWsOverlay();
  updateWsHeader();
  // 해당 ws 데이터로 컨텍스트/선택 초기화 후 로드
  resetToWs(ws);
}

function updateWsHeader() {
  if (!currentWs) return;
  document.getElementById('ws-header-name').textContent = currentWs.name;
  document.getElementById('ws-header-icon').textContent = currentWs.type === 'team' ? '👥' : '🧑‍💻';
  const badge = document.getElementById('ws-header-type');
  badge.textContent = currentWs.type === 'team' ? 'TEAM' : 'SOLO';
  badge.className = `ws-header-type ${currentWs.type}`;
}

// ── 초대코드 복사
function copyInviteCode(inputId) {
  const val = document.getElementById(inputId)?.value;
  if (!val) return;
  navigator.clipboard.writeText(val).then(() => {
    const btn = document.getElementById('copy-new-code-btn');
    if (btn) { btn.textContent = '✓ 복사됨'; btn.classList.add('copied'); }
    setTimeout(() => { if(btn){btn.textContent='📋 복사';btn.classList.remove('copied');} }, 1800);
    showToastMsg('초대코드 복사됨!');
  });
}

// ── 활동 피드 저장/로드 (Firebase 팀 공유)
function wsFeedKey(wsId) { return `tp_feed_${wsId}`; }

async function loadFeed(wsId) {
  const ws = loadWsList().find(w => w.id === wsId);
  try {
    if (ws && ws.type === 'team') {
      const val = await fbGet(`workspaces/${wsId}/feed`);
      if (val) return Object.values(val).sort((a, b) => b.ts - a.ts);
      return [];
    }
  } catch(e) { console.warn('Firebase feed load failed', e); }
  try {
    const v = localStorage.getItem(wsFeedKey(wsId));
    if (v) return JSON.parse(v);
  } catch(e) {}
  return [];
}

async function saveFeedItem(wsId, item) {
  const ws = loadWsList().find(w => w.id === wsId);
  try {
    if (ws && ws.type === 'team') {
      await fbPush(`workspaces/${wsId}/feed`, item);
      return;
    }
  } catch(e) { console.warn('Firebase feed save failed', e); }
  try {
    const feed = JSON.parse(localStorage.getItem(wsFeedKey(wsId)) || '[]');
    feed.unshift(item);
    localStorage.setItem(wsFeedKey(wsId), JSON.stringify(feed.slice(0, 30)));
  } catch(e) {}
}

function makeFeedTags() {
  const tags = [];
  const hasView = viewPromptActive && window._viewGeneratedPrompt;
  if (hasView) tags.push({ label: '🎨 뷰 생성', cls: 'view' });
  DATA.forEach(sec => {
    const n = sec.items.filter(i => selected.has(i.id)).length
            + ((customItems[sec.id]||[]).filter(i=>selected.has(i.id)).length);
    if (!n) return;
    const cls = sec.id.startsWith('pimpl') ? 'be'
              : sec.id === 'pfront' ? 'fe'
              : sec.id === 'pdebug' ? 'debug'
              : sec.id.startsWith('pplan') ? 'plan' : '';
    tags.push({ label: `${sec.title.split(' ').slice(0,2).join(' ')} ×${n}`, cls });
  });
  return tags;
}

// ── 워크스페이스 목록 렌더링 (활동 피드 포함)
async function renderWsList() {
  const list = loadWsList();
  const el   = document.getElementById('ws-room-list');
  if (!list.length) {
    el.innerHTML = '<div class="ws-empty-rooms">아직 워크스페이스가 없어요<br>새로 만들거나 초대코드로 입장해봐요</div>';
    return;
  }

  // 먼저 기본 렌더
  el.innerHTML = list.map(ws => {
    const isTeam = ws.type === 'team';
    const codeHtml = isTeam
      ? `<div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
           <span style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:var(--teal);letter-spacing:0.1em;">${ws.code}</span>
           <button onclick="event.stopPropagation();copyCodeDirect('${ws.code}')" style="font-family:'JetBrains Mono',monospace;font-size:9px;padding:2px 7px;background:var(--teal-bg);border:1px solid rgba(45,212,191,0.3);border-radius:10px;color:var(--teal);cursor:pointer;" id="ccbtn-${ws.id}">복사</button>
         </div>` : '';
    return `
    <div class="ws-room-item-wrap" id="wrap-${ws.id}">
      <div class="ws-room-item ${ws.type}${isTeam?' team-expandable':' no-feed'}" onclick="${isTeam?`toggleFeedPanel('${ws.id}')`:''};${!isTeam?`enterWorkspace(${JSON.stringify(ws).replace(/"/g,'&quot;')})`:''}" id="ri-${ws.id}">
        <div class="ws-room-icon ${ws.type}">${isTeam?'👥':'🧑‍💻'}</div>
        <div class="ws-room-info">
          <div class="ws-room-name">${escHtml(ws.name)}</div>
          <div class="ws-room-meta">${isTeam ? `초대코드` : '개인 전용'} · ${timeAgo(ws.createdAt)}</div>
          ${codeHtml}
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;">
          <span class="ws-room-badge ${ws.type}">${isTeam?'TEAM':'SOLO'}</span>
          ${isTeam ? `<span style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--text3);" id="chev-feed-${ws.id}">▼ 활동</span>` : ''}
        </div>
        <button class="ws-room-del" onclick="event.stopPropagation();deleteWs('${ws.id}')">✕</button>
      </div>
      ${isTeam ? `
      <div class="ws-activity-panel" id="feed-panel-${ws.id}">
        <div class="ws-activity-header">
          <div class="ws-activity-title"><div class="ws-activity-dot"></div>팀 활동 피드</div>
          <div style="display:flex;gap:6px;align-items:center;">
            <span class="ws-activity-count" id="feed-cnt-${ws.id}">로딩 중...</span>
            <button onclick="event.stopPropagation();enterWorkspace(${JSON.stringify(ws).replace(/"/g,'&quot;')})"
              style="font-family:'JetBrains Mono',monospace;font-size:10px;padding:3px 10px;background:var(--purple-bg);border:1px solid rgba(167,139,250,0.3);border-radius:10px;color:var(--purple);cursor:pointer;">
              → 입장
            </button>
          </div>
        </div>
        <div class="ws-feed-list" id="feed-list-${ws.id}">
          <div class="ws-feed-empty">클릭해서 활동 기록을 불러와요</div>
        </div>
      </div>` : ''}
    </div>`;
  }).join('');
}

let openFeedPanels = new Set();

async function toggleFeedPanel(wsId) {
  const panel = document.getElementById(`feed-panel-${wsId}`);
  const chev  = document.getElementById(`chev-feed-${wsId}`);
  const item  = document.getElementById(`ri-${wsId}`);
  if (!panel) return;

  if (openFeedPanels.has(wsId)) {
    openFeedPanels.delete(wsId);
    panel.classList.remove('open');
    if(chev) chev.textContent = '▼ 활동';
    if(item) { item.style.borderRadius = ''; item.style.borderBottom = ''; }
  } else {
    openFeedPanels.add(wsId);
    panel.classList.add('open');
    if(chev) chev.textContent = '▲ 활동';
    if(item) { item.style.borderRadius = 'var(--radius-sm) var(--radius-sm) 0 0'; item.style.borderBottom = 'none'; }
    await renderFeedPanel(wsId);
  }
}

async function renderFeedPanel(wsId) {
  const listEl = document.getElementById(`feed-list-${wsId}`);
  const cntEl  = document.getElementById(`feed-cnt-${wsId}`);
  if (!listEl) return;

  listEl.innerHTML = '<div class="ws-feed-empty" style="color:var(--blue)">불러오는 중...</div>';
  const feed = await loadFeed(wsId);

  if (!feed.length) {
    listEl.innerHTML = '<div class="ws-feed-empty">아직 활동 기록이 없어요<br>프롬프트를 복사하면 여기 기록돼요</div>';
    if (cntEl) cntEl.textContent = '0건';
    return;
  }

  if (cntEl) cntEl.textContent = `${feed.length}건`;
  listEl.innerHTML = feed.map(f => `
    <div class="ws-feed-item">
      <div class="ws-feed-avatar">${f.part ? f.part[0].toUpperCase() : '?'}</div>
      <div class="ws-feed-body">
        <div class="ws-feed-top">
          <span class="ws-feed-part">${escHtml(f.part || '익명')}</span>
          <span class="ws-feed-time">${timeAgo(f.ts)}</span>
        </div>
        <div class="ws-feed-tags">
          ${(f.tags||[]).map(t=>`<span class="ws-feed-tag ${t.cls}">${escHtml(t.label)}</span>`).join('')}
          ${(!f.tags||!f.tags.length)?'<span class="ws-feed-tag">기타</span>':''}
        </div>
      </div>
    </div>
  `).join('');
}

function copyCodeDirect(code) {
  navigator.clipboard.writeText(code).then(() => showToastMsg('초대코드 복사됨!'));
}

function handleOverlayClick(e) {
  // 모달 바깥(오버레이 배경) 클릭 시만 닫기
  if (e.target === document.getElementById('ws-overlay')) {
    // 워크스페이스가 없으면 닫지 않음 (강제 선택)
    if (currentWs) closeWsOverlay();
  }
}

function deleteWs(id) {
  const ws = loadWsList().find(w => w.id === id);
  const name = ws ? ws.name : '이 워크스페이스';
  if (!confirm(`"${name}"을 삭제할까요?\n삭제하면 복구할 수 없어요.`)) return;
  const list = loadWsList().filter(w => w.id !== id);
  saveWsList(list);
  if (currentWs && currentWs.id === id) {
    currentWs = null;
    try { localStorage.removeItem(WS_CURRENT_KEY); } catch(e) {}
    openWsOverlay();
  }
  renderWsList();
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const d = Math.floor(diff / 86400000);
  if (d === 0) return '오늘';
  if (d === 1) return '어제';
  if (d < 7)  return `${d}일 전`;
  if (d < 30) return `${Math.floor(d/7)}주 전`;
  return `${Math.floor(d/30)}개월 전`;
}

async function openWsOverlay() {
  document.getElementById('ws-overlay').classList.remove('hidden');
  switchWsTab('list');
  await renderWsList();
}
function closeWsOverlay() {
  document.getElementById('ws-overlay').classList.add('hidden');
}

// ── STORAGE KEYS (워크스페이스 기반 동적 키) ======================
function SHARED_KEY()   { return currentWs ? wsSharedKey(currentWs.id)   : 'tp_shared_default'; }
function PERSONAL_KEY() { return currentWs ? wsPersonalKey(currentWs.id) : 'tp_personal_default'; }
function SELECTED_KEY() { return currentWs ? wsSelectedKey(currentWs.id) : 'tp_selected_default'; }
function CUSTOM_KEY()   { return currentWs ? wsCustomKey(currentWs.id)   : 'tp_custom_default'; }

// ====================== DATA ======================
const DATA = [
  {
    id: 'pctx',
    title: '📌 프로젝트 컨텍스트',
    badge: 'CONTEXT', badgeClass: 'badge-purple', colorClass: 'c-purple',
    items: [
      { id: 'pctx1', label: '프로젝트 맥락 전달', sub: '이 컨텍스트 기억하고 답해줘',
        prompt: '아래 프로젝트를 진행 중이야. 내가 이후에 질문할 때 이 컨텍스트를 항상 바탕으로 답해줘. 모르는 부분은 추측하지 말고 질문해.' },
      { id: 'pctx2', label: '기존 스택 안에서 해결', sub: '새 라이브러리 도입 최소화',
        prompt: '지금 쓰는 스택 안에서 해결하는 방법을 먼저 알려줘. 새 라이브러리 도입이 꼭 필요하면 이유와 대안도 같이 말해줘.' },
      { id: 'pctx3', label: '현실적인 방향으로', sub: '이상 vs 현실 트레이드오프',
        prompt: '완벽한 구현보다 지금 상황에서 현실적으로 가능한 방향을 알려줘. 이상적인 방법과 빠른 방법 둘 다 보여주고 트레이드오프를 설명해줘.' },
      { id: 'pctx4', label: '팀 컨벤션 맞춰서', sub: '규칙/스타일 가이드 반영',
        prompt: '위에서 말한 팀 컨벤션과 규칙에 맞게 코드나 구조를 제안해줘. 컨벤션에서 벗어나면 짚어줘.' },
      { id: 'pctx5', label: '풀스택 관점으로', sub: '백/프론트 연동까지 고려',
        prompt: '백엔드(Spring Boot)와 프론트엔드(React) 양쪽 관점에서 같이 생각해줘. API 계약, 데이터 형식, 에러 처리를 양쪽 다 고려해줘.' },
      { id: 'pctx6', label: '백엔드 관점으로만', sub: '백엔드 중심으로 고려',
        prompt: '백엔드(Spring Boot/Java) 관점에서만 집중해서 답해줘. 서버 사이드 로직, 데이터 처리, API 설계, 성능 위주로 깊게 파줘. 프론트 얘기는 최소화해.' },
      { id: 'pctx7', label: '실무 스타일로', sub: '실무에서 많이 쓰는 구조와 스타일',
        prompt: '교과서적인 방법보다 실무에서 실제로 많이 쓰이는 패턴과 구조로 알려줘. 현장에서 쓰기 편한 코드 스타일, 관행, 자주 쓰는 라이브러리 기준으로.' },
      { id: 'pctx8', label: '코드 품질 엄격하게', sub: '클린 코드 / 리뷰 통과 기준',
        prompt: '코드 리뷰에서 통과할 수 있는 수준으로 짜줘. 네이밍, 단일 책임, 중복 제거, 예외 처리까지 꼼꼼하게. 아쉬운 부분은 직접 지적해줘.' },
    ]
  },
  {
    id: 'pplan',
    title: '🧠 구현 전 방향 잡기',
    badge: 'PLAN', badgeClass: 'badge-blue', colorClass: 'c-blue',
    items: [
      { id: 'pplan1', label: '어떻게 짜면 좋을까?', sub: '구현 방향 브레인스토밍',
        prompt: '아래 기능을 구현하려고 하는데 어떻게 접근하면 좋을지 방향을 잡아줘. 코드 바로 짜지 말고 먼저 설계/흐름을 같이 생각해보자.' },
      { id: 'pplan2', label: 'A vs B 뭐가 나아?', sub: '두 가지 방법 비교',
        prompt: '두 가지 방법을 비교해줘. 각각의 장단점, 어떤 상황에서 뭘 쓰는 게 맞는지, 지금 이 프로젝트엔 뭐가 더 적합한지 알려줘.' },
      { id: 'pplan3', label: '이 방향 문제없어?', sub: '내 설계 검증 요청',
        prompt: '아래 방향으로 구현하려고 하는데 문제가 있거나 더 나은 방법이 있으면 말해줘. 동의하는 부분은 넘어가고 개선점만 짚어줘.' },
      { id: 'pplan4', label: 'DB 설계 같이 잡자', sub: '스키마/ERD 초안 작성',
        prompt: '이 도메인 요구사항을 보고 테이블 구조(컬럼, 관계, 인덱스)를 잡아줘. JPA Entity로 바로 옮길 수 있는 형태로. 애매한 부분은 선택지 주고 이유 설명해줘.' },
      { id: 'pplan5', label: 'API 명세 초안 잡기', sub: 'URL/Request/Response 설계',
        prompt: '이 기능에 필요한 API 명세를 잡아줘. 엔드포인트, HTTP 메서드, Request Body/Params, Response 형식, 에러 케이스를 포함해서. React에서 쓰기 편한 형태로 설계해줘.' },
      { id: 'pplan6', label: '작업 단위로 쪼개줘', sub: '태스크 분해 / 순서 정리',
        prompt: '이 기능 구현을 작은 단위로 쪼개줘. 어떤 순서로 작업하면 좋은지, 각 태스크 간 의존성도 정리해줘. 백엔드/프론트엔드 작업을 분리해서 보여줘.' },
    ]
  },
  {
    id: 'pimpl',
    title: '⚙️ 백엔드 구현 (Spring Boot)',
    badge: 'BE', badgeClass: 'badge-green', colorClass: 'c-green',
    items: [
      { id: 'pimpl1', label: '이 기능 구현해줘', sub: 'Controller ~ Repository 전체',
        prompt: '아래 기능을 Spring Boot로 구현해줘. Controller, Service, Repository, DTO, Entity 전부 포함해서. 빠뜨린 게 있으면 말해줘.' },
      { id: 'pimpl2', label: 'Service 로직 작성', sub: '비즈니스 로직 + 트랜잭션',
        prompt: 'Service 로직을 작성해줘. 트랜잭션 범위, 예외 처리(@ExceptionHandler), 유효성 검사까지. 왜 이렇게 짰는지 핵심 판단 근거도 코멘트로 달아줘.' },
      { id: 'pimpl3', label: 'JPA 연관관계 잡기', sub: '매핑 설계 + N+1 방지',
        prompt: 'JPA 연관관계 매핑을 잡아줘. FetchType, cascade, orphanRemoval 설정 이유도 설명해줘. N+1이 생길 수 있는 부분은 미리 fetch join이나 EntityGraph로 처리해줘.' },
      { id: 'pimpl4', label: '예외 처리 구조 잡기', sub: 'CustomException + 에러 코드',
        prompt: '커스텀 예외 클래스와 GlobalExceptionHandler를 만들어줘. 프론트에서 에러 처리하기 편하게 에러 코드/메시지 형식도 통일해줘.' },
      { id: 'pimpl5', label: '인증 붙이기', sub: 'JWT + Spring Security',
        prompt: 'JWT 기반 인증을 붙여줘. Security Filter Chain 설정, 토큰 발급/검증 로직, 권한별 접근 제어까지. React에서 API 호출할 때 어떻게 붙여야 하는지도 알려줘.' },
      { id: 'pimpl6', label: '쿼리 최적화', sub: 'JPQL/Native 쿼리, 인덱스',
        prompt: '이 쿼리를 최적화해줘. N+1 여부 확인, fetch join/Projection/Native Query 중 뭐가 나은지 판단해줘. 인덱스 추가가 필요하면 그것도 알려줘.' },
    ]
  },
  {
    id: 'pfront',
    title: '🎨 프론트엔드 구현 (React)',
    badge: 'FE', badgeClass: 'badge-teal', colorClass: 'c-teal',
    items: [
      { id: 'pfe1', label: '이 컴포넌트 만들어줘', sub: 'React 컴포넌트 구현',
        prompt: '아래 기능을 하는 React 컴포넌트를 만들어줘. props 타입, 상태 관리, 이벤트 처리 포함해서. 재사용 가능하게 설계해줘.' },
      { id: 'pfe2', label: '상태 관리 방향 잡기', sub: '로컬 state vs 전역 상태',
        prompt: '이 기능에서 상태를 어떻게 관리하면 좋을지 잡아줘. 로컬 state로 충분한지, Context나 Zustand 같은 전역 상태가 필요한지. 지금 프로젝트 규모에 맞게 추천해줘.' },
      { id: 'pfe3', label: 'API 연동 코드 짜줘', sub: 'Axios/fetch + 에러 처리',
        prompt: '이 API를 React에서 호출하는 코드를 짜줘. 로딩/에러/성공 상태 처리, JWT 토큰 헤더 자동 첨부, 401 만료 처리까지 포함해줘.' },
      { id: 'pfe4', label: '커스텀 훅으로 분리', sub: 'useXxx 훅 추출',
        prompt: '이 로직을 커스텀 훅으로 분리해줘. 컴포넌트가 UI에만 집중하도록. 훅 인터페이스(입력/출력)를 깔끔하게 설계해줘.' },
      { id: 'pfe5', label: '폼 처리 & 유효성 검사', sub: 'React Hook Form / 직접 구현',
        prompt: '이 폼을 구현해줘. 입력값 유효성 검사, 에러 메시지 표시, 제출 처리까지. 백엔드 에러(API 응답 에러)도 폼에 표시할 수 있게 해줘.' },
      { id: 'pfe6', label: '성능 최적화', sub: 'memo, useCallback, lazy',
        prompt: '이 컴포넌트에서 불필요한 리렌더링이나 성능 이슈가 있는지 봐줘. React.memo, useCallback, useMemo, lazy loading 중 필요한 것만 골라서 적용해줘.' },
    ]
  },
  {
    id: 'pdebug',
    title: '🐛 디버깅',
    badge: 'DEBUG', badgeClass: 'badge-red', colorClass: 'c-red',
    items: [
      { id: 'pdbg1', label: '에러 왜 나는 거야?', sub: '스택트레이스 / 콘솔 에러 분석',
        prompt: '아래 에러가 왜 나는지 분석해줘. 원인, 빠른 해결법, 근본적인 해결법을 구분해서 알려줘. 비슷한 실수 패턴도 있으면 같이 말해줘.' },
      { id: 'pdbg2', label: '이상하게 동작해', sub: '의도와 다른 동작 원인 추적',
        prompt: '코드가 의도한 대로 안 움직여. 아래 코드와 실제 동작/기대 동작을 보고 어디서 꼬인 건지 찾아줘.' },
      { id: 'pdbg3', label: 'CORS 에러 해결', sub: 'Spring + React 연동 문제',
        prompt: 'CORS 에러가 나고 있어. Spring Security 설정이랑 React 호출 코드 보고 뭐가 문제인지 찾아줘. 로컬/배포 환경 둘 다 되게 설정해줘.' },
      { id: 'pdbg4', label: '로컬은 되는데 배포는 안 돼', sub: '환경 차이 체크리스트',
        prompt: '로컬에선 잘 되는데 배포 환경에서 안 돼. 환경변수, 설정 파일, 빌드 차이, 네트워크 설정 등 체크해야 할 항목들을 순서대로 알려줘.' },
      { id: 'pdbg5', label: 'API 응답이 이상해', sub: '요청/응답 불일치 분석',
        prompt: '백엔드 API 응답이 기대랑 달라. 아래 요청/응답 내용을 보고 Spring 쪽 문제인지 React 쪽 파싱 문제인지 찾아줘.' },
      { id: 'pdbg6', label: '느려졌어 왜 이러지', sub: '성능 저하 원인 분석',
        prompt: '갑자기 API가 느려졌거나 프론트가 버벅거려. 백엔드는 쿼리/메모리, 프론트는 렌더링/번들 관점에서 원인을 찾고 개선 방향을 알려줘.' },
    ]
  },
  {
    id: 'preview',
    title: '🔍 코드 리뷰 & 개선',
    badge: 'REVIEW', badgeClass: 'badge-amber', colorClass: 'c-amber',
    items: [
      { id: 'prev1', label: 'PR 전에 한 번 봐줘', sub: '전반적인 코드 리뷰',
        prompt: 'PR 올리기 전에 이 코드 한 번 봐줘. 놓친 게 있거나 팀원이 의문 가질 만한 부분, 개선하면 좋을 부분 알려줘. 사소한 것도 다 말해줘.' },
      { id: 'prev2', label: '더 깔끔하게 짤 수 있어?', sub: '리팩터링 제안',
        prompt: '이 코드를 더 읽기 쉽고 유지보수하기 좋게 바꿔줘. 중복, 복잡한 로직, 네이밍 문제 등. 수정 전/후 비교해서 보여줘.' },
      { id: 'prev3', label: '보안 이슈 있어?', sub: '취약점 검토',
        prompt: '이 코드에 보안 문제가 있는지 봐줘. SQL Injection, XSS, CSRF, 인증 우회, 민감 정보 노출 등. 문제가 있으면 수정 코드도 같이 줘.' },
      { id: 'prev4', label: '예외 처리 빠진 거 없어?', sub: '엣지 케이스 점검',
        prompt: '이 코드에서 예외 처리나 엣지 케이스가 빠진 부분 찾아줘. null 처리, 빈 값, 권한 없는 경우, 타임아웃 등 실무에서 실제로 터지는 케이스 중심으로.' },
      { id: 'prev5', label: '백/프론트 계약 맞아?', sub: 'API 인터페이스 정합성',
        prompt: '백엔드 API 응답이랑 프론트에서 쓰는 방식이 일치하는지 봐줘. 필드명, 타입, 널 처리, 에러 응답 형식 등에서 불일치 있으면 다 짚어줘.' },
    ]
  },
  {
    id: 'pgit',
    title: '📝 PR & 커밋 & 문서',
    badge: 'GIT', badgeClass: 'badge-purple', colorClass: 'c-purple',
    items: [
      { id: 'pgit1', label: '커밋 메시지 써줘', sub: 'Conventional Commits 형식',
        prompt: '아래 변경사항을 보고 커밋 메시지를 써줘. Conventional Commits 형식(feat/fix/refactor 등)으로. 메시지 후보를 2~3개 줘서 고를 수 있게 해줘.' },
      { id: 'pgit2', label: 'PR 설명 써줘', sub: '변경사항 요약 + 리뷰 포인트',
        prompt: '이 변경사항으로 PR 설명을 써줘. 왜 바꿨는지(배경), 뭘 바꿨는지(변경 내용), 리뷰어가 집중해서 봐야 할 부분, 테스트 방법을 포함해줘.' },
      { id: 'pgit3', label: 'README 작성', sub: '프로젝트 소개 + 실행 방법',
        prompt: '이 프로젝트의 README를 작성해줘. 프로젝트 소개, 기술 스택, 아키텍처, 실행 방법(로컬/Docker), 환경변수 설명을 포함해줘. 읽기 쉽게.' },
      { id: 'pgit4', label: 'API 명세 문서화', sub: 'Swagger / 마크다운 정리',
        prompt: '이 API들을 문서화해줘. 엔드포인트, 설명, Request/Response 예시, 에러 케이스를 마크다운 표 형식으로 정리해줘. Swagger 어노테이션도 같이 줘.' },
      { id: 'pgit5', label: '코드 주석 달아줘', sub: '복잡한 로직 설명 주석',
        prompt: '이 코드에 주석을 달아줘. 왜 이렇게 구현했는지(WHY) 위주로. 코드만 봐서는 이해하기 어려운 비즈니스 로직이나 예외 케이스에 집중해줘.' },
      { id: 'pgit6', label: '기술 선택 근거 정리', sub: '의사결정 문서(ADR)',
        prompt: '이 기술/방법을 선택한 이유를 문서로 정리해줘. 검토한 대안들, 각각의 장단점, 최종 선택 이유를 ADR(Architecture Decision Record) 형식으로.' },
    ]
  },
  {
    id: 'pdeploy',
    title: '🚀 배포 & 인프라',
    badge: 'DEPLOY', badgeClass: 'badge-teal', colorClass: 'c-teal',
    items: [
      { id: 'pdep1', label: 'Dockerfile 작성', sub: 'Spring Boot + React 컨테이너화',
        prompt: 'Spring Boot 백엔드와 React 프론트엔드 각각의 Dockerfile을 작성해줘. 멀티 스테이지 빌드, 이미지 최적화 적용해줘.' },
      { id: 'pdep2', label: 'docker-compose 설정', sub: '로컬 풀스택 환경',
        prompt: '로컬에서 풀스택으로 돌릴 수 있는 docker-compose.yml을 만들어줘. Spring Boot + React + MySQL + Redis 포함. 핫리로드도 되면 좋겠어.' },
      { id: 'pdep3', label: 'GitHub Actions CI/CD', sub: '자동 빌드/배포',
        prompt: 'GitHub Actions 워크플로우를 만들어줘. PR 시 빌드+테스트, main 머지 시 배포. 백엔드/프론트엔드 변경 감지해서 필요한 것만 배포하도록.' },
      { id: 'pdep4', label: '환경변수 관리', sub: '로컬/스테이징/프로덕션 분리',
        prompt: '환경별(로컬/스테이징/프로덕) 설정을 어떻게 관리할지 잡아줘. Spring은 application.yml, React는 .env 파일 기준. 시크릿 안전하게 다루는 방법도.' },
    ]
  },
  {
    id: 'pview',
    title: '🎨 뷰 생성',
    badge: 'VIEW', badgeClass: 'badge-teal', colorClass: 'c-teal',
    isViewSection: true,
    items: [
      { id: 'pview_base', label: '기본 출력 규칙', sub: '항상 포함되는 베이스 지시',
        prompt: 'React로 아래 뷰를 만들어줘. 실제 프로젝트에 바로 붙일 수 있는 완성된 컴포넌트로 작성해줘. 임시 데이터는 주석이나 TODO로 표시해줘.' },
      { id: 'pview_stack', label: '스타일링 방식 명시', sub: '어떤 방식으로 스타일 쓸지',
        prompt: '스타일은 프로젝트에서 사용 중인 방식으로 맞춰줘. CSS Modules나 styled-components 사용 시 따로 말할게. 별도 언급 없으면 일반 className으로 짜줘.' },
      { id: 'pview_responsive', label: '반응형 포함', sub: '모바일/태블릿/데스크탑 대응',
        prompt: '반응형으로 만들어줘. 모바일(~768px), 태블릿(~1024px), 데스크탑 기준으로. 레이아웃이 자연스럽게 바뀌게 해줘.' },
      { id: 'pview_api', label: 'API 연동 포함', sub: 'useEffect + fetch/axios 포함',
        prompt: 'API 연동 코드도 같이 짜줘. useEffect로 데이터 fetch, 로딩/에러/빈 상태 UI도 포함해줘. API 엔드포인트는 TODO로 표시해줘.' },
      { id: 'pview_state', label: '상태 관리 포함', sub: 'useState / 폼 상태 등',
        prompt: '필요한 상태 관리 코드도 포함해줘. 폼이면 입력 상태, 유효성 검사, 제출 처리까지. 복잡하면 커스텀 훅으로 분리해줘.' },
      { id: 'pview_ts', label: 'TypeScript 타입 포함', sub: 'Props / API 응답 타입 정의',
        prompt: 'TypeScript로 짜줘. Props 타입, API 응답 타입, 이벤트 핸들러 타입까지 꼼꼼하게 정의해줘.' },
      { id: 'pview_clean', label: '컴포넌트 분리', sub: '역할별로 잘게 쪼개기',
        prompt: '하나의 파일에 다 넣지 말고 역할별로 컴포넌트를 분리해줘. 어떤 파일로 쪼갤지도 파일 구조랑 같이 보여줘.' },
      { id: 'pview_a11y', label: '접근성 챙기기', sub: 'aria, semantic HTML',
        prompt: '접근성도 챙겨줘. 의미에 맞는 시맨틱 태그, aria-label, 키보드 접근 가능 여부까지. 특히 폼이나 모달은 꼼꼼히.' },
    ]
  },
  {
    id: 'ptest',
    title: '🧪 테스트',
    badge: 'TEST', badgeClass: 'badge-green', colorClass: 'c-green',
    items: [
      { id: 'ptst1', label: '단위 테스트 작성해줘', sub: 'JUnit5 + Mockito',
        prompt: '이 Service/클래스에 대한 단위 테스트를 JUnit5 + Mockito로 작성해줘. 정상 케이스, 예외 케이스 모두 커버해줘. given/when/then 패턴으로.' },
      { id: 'ptst2', label: 'API 통합 테스트', sub: 'MockMvc + TestContainers',
        prompt: '이 API에 대한 통합 테스트를 작성해줘. MockMvc로 요청/응답 검증, 실제 DB는 H2 또는 TestContainers 사용. 인증이 필요한 API면 그것도 처리해줘.' },
      { id: 'ptst3', label: '뭘 테스트해야 해?', sub: '테스트 케이스 도출',
        prompt: '이 기능에서 테스트해야 할 케이스들을 뽑아줘. 해피 패스, 예외 케이스, 경계값, 놓치기 쉬운 시나리오 중심으로. 우선순위도 붙여줘.' },
      { id: 'ptst4', label: 'React 컴포넌트 테스트', sub: 'Jest + Testing Library',
        prompt: '이 React 컴포넌트에 대한 테스트를 Jest + React Testing Library로 작성해줘. 렌더링, 사용자 인터랙션, API 호출 모킹까지 포함해줘.' },
    ]
  },
];

// ====================== STATE ======================
const selected = new Set();
const customItems = {};
const collapsed = new Set();
let sharedCtx = {};    // 팀 공유: topic, stack, rules, extra
let personalCtx = {};  // 개인: part

// ====================== FIREBASE HELPERS ======================
function waitForFirebase() {
  return new Promise(resolve => {
    if (window._fbReady) { resolve(); return; }
    window.addEventListener('firebase-ready', () => resolve(), { once: true });
  });
}
async function fbSet(path, data) {
  await waitForFirebase();
  return window._fbSet(window._fbRef(window._fbDb, path), data);
}
async function fbGet(path) {
  await waitForFirebase();
  const snap = await window._fbGet(window._fbRef(window._fbDb, path));
  return snap.exists() ? snap.val() : null;
}
async function fbPush(path, data) {
  await waitForFirebase();
  return window._fbPush(window._fbRef(window._fbDb, path), data);
}

// ====================== PERSISTENT STORAGE (Firebase 팀 공유) ======================
async function loadSharedCtx() {
  if (!currentWs) return;
  try {
    if (currentWs.type === 'team') {
      const val = await fbGet(`workspaces/${currentWs.id}/sharedCtx`);
      if (val) { sharedCtx = val; return; }
    }
  } catch(e) { console.warn('Firebase load failed', e); }
  try {
    const v = localStorage.getItem(SHARED_KEY());
    if (v) sharedCtx = JSON.parse(v);
  } catch(_) {}
}

async function saveSharedCtx(data) {
  if (!currentWs) return;
  try {
    if (currentWs.type === 'team') {
      await fbSet(`workspaces/${currentWs.id}/sharedCtx`, data);
      return;
    }
  } catch(e) { console.warn('Firebase save failed', e); }
  try { localStorage.setItem(SHARED_KEY(), JSON.stringify(data)); } catch(_) {}
}

// ====================== LOCAL STORAGE (개인) ======================
function loadPersonalCtx() {
  try {
    const v = localStorage.getItem(PERSONAL_KEY());
    if (v) personalCtx = JSON.parse(v);
  } catch(e) {}
}

function savePersonalCtx(data) {
  try { localStorage.setItem(PERSONAL_KEY(), JSON.stringify(data)); } catch(e) {}
}

function loadLocalState() {
  try {
    const sel = localStorage.getItem(SELECTED_KEY());
    if (sel) JSON.parse(sel).forEach(id => selected.add(id));
    const ci = localStorage.getItem(CUSTOM_KEY());
    if (ci) { const p = JSON.parse(ci); Object.keys(p).forEach(k => { customItems[k] = p[k]; }); }
  } catch(e) {}
}

function saveLocalState() {
  try {
    localStorage.setItem(SELECTED_KEY(), JSON.stringify([...selected]));
    localStorage.setItem(CUSTOM_KEY(), JSON.stringify(customItems));
  } catch(e) {}
}

// ====================== CONTEXT PANEL ======================
let ctxPanelOpen = true;

function toggleContextPanel() {
  ctxPanelOpen = !ctxPanelOpen;
  const panel = document.getElementById('context-panel');
  const chev = document.getElementById('ctx-chevron');
  panel.classList.toggle('collapsed', !ctxPanelOpen);
  chev.classList.toggle('open', ctxPanelOpen);
}

function fillInputsFromCtx() {
  if (sharedCtx.topic) document.getElementById('ctx-topic').value = sharedCtx.topic;
  if (sharedCtx.stack) document.getElementById('ctx-stack').value = sharedCtx.stack;
  if (sharedCtx.rules) document.getElementById('ctx-rules').value = sharedCtx.rules;
  if (sharedCtx.extra) document.getElementById('ctx-extra').value = sharedCtx.extra;
  if (personalCtx.part) document.getElementById('ctx-part').value = personalCtx.part;
}

async function saveContext() {
  const btn = document.getElementById('ctx-save-btn');
  const statusEl = document.getElementById('ctx-status');
  const badge = document.getElementById('sync-badge');

  btn.disabled = true;
  statusEl.textContent = '저장 중...';
  statusEl.className = 'ctx-status syncing';
  badge.textContent = '⟳ 동기화 중';
  badge.className = 'sync-badge syncing';

  const newShared = {
    topic: document.getElementById('ctx-topic').value.trim(),
    stack: document.getElementById('ctx-stack').value.trim(),
    rules: document.getElementById('ctx-rules').value.trim(),
    extra: document.getElementById('ctx-extra').value.trim(),
  };
  const newPersonal = {
    part: document.getElementById('ctx-part').value.trim(),
  };

  await saveSharedCtx(newShared);
  savePersonalCtx(newPersonal);
  sharedCtx = newShared;
  personalCtx = newPersonal;

  btn.disabled = false;
  statusEl.textContent = '✓ 저장 완료! 팀 공유 항목이 동기화됐어요';
  statusEl.className = 'ctx-status ok';
  badge.textContent = (currentWs && currentWs.type === 'solo') ? '🔒 개인 전용' : '🔗 공유됨';
  badge.className = (currentWs && currentWs.type === 'solo') ? 'sync-badge personal' : 'sync-badge shared';

  updateBanner();
  updatePrompt();

  // 패널 접기
  setTimeout(() => {
    toggleContextPanel();
  }, 800);
}

function updateBanner() {
  const banner = document.getElementById('context-banner');
  const tags = [];
  if (sharedCtx.topic) tags.push({ label: '주제', val: sharedCtx.topic, cls: '' });
  if (sharedCtx.stack) tags.push({ label: '스택', val: sharedCtx.stack, cls: '' });
  if (sharedCtx.rules) tags.push({ label: '규칙', val: sharedCtx.rules.substring(0,30) + (sharedCtx.rules.length>30?'…':''), cls: '' });
  if (personalCtx.part) tags.push({ label: '내 파트', val: personalCtx.part, cls: ' personal-tag' });

  if (tags.length) {
    banner.classList.add('visible');
    banner.innerHTML =
      '<span class="ctx-banner-label">컨텍스트 →</span>' +
      tags.map(t => `<span class="ctx-tag${t.cls}">${t.label}: ${escHtml(t.val)}</span>`).join('') +
      '<button class="ctx-edit-btn" onclick="openContextPanel()">수정</button>';
  } else {
    banner.classList.remove('visible');
  }
}

function openContextPanel() {
  if (!ctxPanelOpen) toggleContextPanel();
}

// ====================== VIEW BUILDER STATE ======================
const VIEW_MOODS = [
  '깔끔하고 심플하게', '모던하고 세련되게', '다크모드 스타일로',
  '밝고 경쾌하게', '미니멀하게', '카드 레이아웃으로',
  '대시보드 스타일로', '모바일 앱 느낌으로', '엔터프라이즈 느낌으로',
  '부드럽고 친근하게',
];
let viewMoodsSelected = new Set();
let viewPromptActive = false;

// 뷰 빌더 입력값 localStorage 저장
function saveViewBuilder() {
  try {
    const data = {
      pageName: document.getElementById('view-page-name')?.value || '',
      pageDesc: document.getElementById('view-page-desc')?.value || '',
      tech:     document.getElementById('view-tech')?.value || '',
      features: document.getElementById('view-features')?.value || '',
      apiInfo:  document.getElementById('view-api')?.value || '',
      refLink:  document.getElementById('view-ref-link')?.value || '',
      moods:    [...viewMoodsSelected],
    };
    localStorage.setItem(VIEW_BUILDER_KEY, JSON.stringify(data));
  } catch(e) {}
}

// 뷰 빌더 입력값 localStorage 복원
function loadViewBuilder() {
  try {
    const raw = localStorage.getItem(VIEW_BUILDER_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    // DOM이 아직 없을 수 있으니 buildOptions 후에 호출
    window._pendingViewRestore = data;
  } catch(e) {}
}

function restoreViewBuilderInputs() {
  const data = window._pendingViewRestore;
  if (!data) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  set('view-page-name', data.pageName);
  set('view-page-desc', data.pageDesc);
  set('view-tech',      data.tech);
  set('view-features',  data.features);
  set('view-api',       data.apiInfo);
  set('view-ref-link',  data.refLink);
  if (data.moods) {
    viewMoodsSelected = new Set(data.moods);
    document.querySelectorAll('.mood-chip').forEach(el => {
      el.classList.toggle('active', viewMoodsSelected.has(el.dataset.mood));
    });
  }
  window._pendingViewRestore = null;
}

function toggleMood(mood) {
  if (viewMoodsSelected.has(mood)) viewMoodsSelected.delete(mood);
  else viewMoodsSelected.add(mood);
  document.querySelectorAll('.mood-chip').forEach(el => {
    el.classList.toggle('active', viewMoodsSelected.has(el.dataset.mood));
  });
  saveViewBuilder();
}

function applyViewPrompt() {
  const pageName  = document.getElementById('view-page-name').value.trim();
  const pageDesc  = document.getElementById('view-page-desc').value.trim();
  const techStack = document.getElementById('view-tech').value.trim() || 'React';
  const features  = document.getElementById('view-features').value.trim();
  const apiInfo   = document.getElementById('view-api').value.trim();
  const refLink   = document.getElementById('view-ref-link').value.trim();
  const moods     = [...viewMoodsSelected];

  if (!pageName) {
    const el = document.getElementById('view-page-name');
    el.focus();
    el.style.borderColor = 'var(--red)';
    setTimeout(() => el.style.borderColor = '', 1500);
    return;
  }

  viewPromptActive = true;

  let prompt = `${techStack}로 [${pageName}] 페이지/컴포넌트를 만들어줘.`;
  if (pageDesc)  prompt += `\n\n이 페이지의 역할: ${pageDesc}`;
  if (features)  prompt += `\n\n포함할 기능/요구사항: ${features}`;
  if (moods.length) prompt += `\n\n디자인 방향: ${moods.join(', ')}`;
  if (apiInfo)   prompt += `\n\nAPI 연동 정보: ${apiInfo}`;
  if (refLink)   prompt += `\n\n참고 사이트/디자인 레퍼런스: ${refLink}`;
  prompt += '\n\n실제 프로젝트에 바로 붙일 수 있는 완성된 컴포넌트로 작성해줘. 임시 데이터는 주석이나 TODO로 표시해줘.';

  window._viewGeneratedPrompt = { id: 'view_generated', prompt, label: `[뷰] ${pageName}` };

  saveViewBuilder();
  updatePrompt();
  saveLocalState();

  const btn = document.getElementById('view-apply-btn');
  btn.textContent = '✓ 적용됨';
  btn.style.background = 'var(--teal)';
  btn.style.color = '#000';
  setTimeout(() => {
    btn.innerHTML = '→ 프롬프트에 추가';
    btn.style.background = '';
    btn.style.color = '';
  }, 1500);
}

function clearViewPrompt() {
  viewPromptActive = false;
  window._viewGeneratedPrompt = null;
  updatePrompt();
}

// ====================== OPTIONS PANEL ======================
function buildOptions() {
  const panel = document.getElementById('options-panel');
  panel.innerHTML = '';
  DATA.forEach(sec => {
    const div = document.createElement('div');
    div.className = 'section';
    div.id = 'sec-' + sec.id;

    // 뷰 섹션: 상단에 전용 빌더 UI 추가
    const viewBuilderHTML = sec.isViewSection ? `
      <div class="view-builder">
        <div class="view-builder-header">
          <div class="view-builder-dot"></div>
          <span class="view-builder-title">뷰 프롬프트 빌더</span>
          <span class="view-builder-desc">입력하고 버튼 누르면 프롬프트 완성</span>
        </div>

        <div class="view-field-grid">
          <div class="view-field">
            <div class="view-field-label">📄 페이지 / 컴포넌트 이름 *</div>
            <input class="view-input" id="view-page-name" placeholder="예) 로그인 페이지, 상품 목록, 마이페이지" oninput="saveViewBuilder()" />
          </div>
          <div class="view-field">
            <div class="view-field-label">⚙️ 기술 스택</div>
            <input class="view-input" id="view-tech" placeholder="예) React, React + TypeScript, JSP" oninput="saveViewBuilder()" />
          </div>
          <div class="view-field view-field-full">
            <div class="view-field-label">💬 이 페이지가 하는 일 (역할 설명)</div>
            <input class="view-input" id="view-page-desc" placeholder="예) 사용자가 이메일/비밀번호로 로그인하거나 소셜 로그인을 할 수 있는 인증 페이지" oninput="saveViewBuilder()" />
          </div>
          <div class="view-field view-field-full">
            <div class="view-field-label">🧩 포함할 기능 / 요구사항</div>
            <textarea class="view-input" id="view-features" rows="2" placeholder="예) 이메일 유효성 검사, 비밀번호 표시/숨기기 토글, 로그인 실패 시 에러 메시지, 자동 로그인 체크박스" oninput="saveViewBuilder()"></textarea>
          </div>
          <div class="view-field">
            <div class="view-field-label">🔗 API 연동 정보 (선택)</div>
            <input class="view-input" id="view-api" placeholder="예) POST /api/auth/login → {token, user}" oninput="saveViewBuilder()" />
          </div>
          <div class="view-field">
            <div class="view-field-label">🌐 참고 사이트 링크 (선택)</div>
            <input class="view-input" id="view-ref-link" placeholder="예) https://dribbble.com/shots/..." oninput="saveViewBuilder()" />
          </div>
        </div>

        <div class="mood-section-label">🎨 디자인 분위기 (복수 선택 가능)</div>
        <div class="mood-chips">
          ${VIEW_MOODS.map(m => `<span class="mood-chip" data-mood="${m}" onclick="toggleMood('${m}')">${m}</span>`).join('')}
        </div>

        <div class="view-footer">
          <span class="view-preview-hint">입력값은 자동 저장돼요 💾</span>
          <button class="view-apply-btn" id="view-apply-btn" onclick="applyViewPrompt()">→ 프롬프트에 추가</button>
        </div>
      </div>

      <div style="grid-column:1/-1; font-family:'JetBrains Mono',monospace; font-size:9px; letter-spacing:0.1em; text-transform:uppercase; color:var(--text3); padding: 4px 0 2px 2px;">
        추가 옵션 선택 (선택사항)
      </div>
    ` : '';

    div.innerHTML = `
      <div class="sec-head" onclick="toggleSec('${sec.id}')">
        <div class="sec-head-left">
          <span class="badge ${sec.badgeClass}">${sec.badge}</span>
          <span class="sec-title">${sec.title}</span>
          <span class="sec-cnt" id="cnt-${sec.id}">0</span>
        </div>
        <span class="chevron open" id="chev-${sec.id}">▼</span>
      </div>
      <div class="sec-body" id="body-${sec.id}">
        ${viewBuilderHTML}
        ${sec.items.map(item => `
          <label class="item" id="item-${item.id}">
            <input type="checkbox" id="cb-${item.id}" onchange="toggle('${item.id}','${sec.id}',this.checked)">
            <div>
              <div class="item-label">${item.label}</div>
              <div class="item-sub">${item.sub}</div>
            </div>
          </label>
        `).join('')}
        <div class="custom-items-wrap" id="custom-wrap-${sec.id}"></div>
        <div class="add-trigger" id="add-trig-${sec.id}" onclick="showAddForm('${sec.id}')">
          <span>+</span> 커스텀 항목 추가
        </div>
        <div class="add-form" id="add-form-${sec.id}">
          <div>
            <div class="add-field-label">항목 이름</div>
            <input class="custom-input" id="add-label-${sec.id}" placeholder="예) 내가 자주 쓰는 요청" />
          </div>
          <div>
            <div class="add-field-label">프롬프트 내용</div>
            <textarea class="custom-input" id="add-prompt-${sec.id}" rows="3" placeholder="Claude에게 보낼 실제 프롬프트 내용을 입력해줘"></textarea>
          </div>
          <div class="add-actions">
            <button class="add-cancel" onclick="hideAddForm('${sec.id}')">취소</button>
            <button class="add-save" onclick="saveNew('${sec.id}')">저장</button>
          </div>
        </div>
      </div>
    `;
    panel.appendChild(div);
  });

  // 저장된 선택 상태 복원
  DATA.forEach(sec => {
    sec.items.forEach(item => {
      if (selected.has(item.id)) {
        const cb = document.getElementById('cb-' + item.id);
        const lbl = document.getElementById('item-' + item.id);
        if (cb) cb.checked = true;
        if (lbl) lbl.classList.add('checked');
      }
    });
    renderCustomItems(sec.id);
    updateSecCount(sec.id);
  });

  // 뷰 빌더 입력값 복원 (DOM이 생긴 후)
  restoreViewBuilderInputs();
}

// ====================== TOGGLE SECTION ======================
function toggleSec(id) {
  const body = document.getElementById('body-' + id);
  const chev = document.getElementById('chev-' + id);
  if (collapsed.has(id)) {
    collapsed.delete(id);
    body.classList.remove('collapsed');
    chev.classList.add('open');
  } else {
    collapsed.add(id);
    body.classList.add('collapsed');
    chev.classList.remove('open');
  }
}

// ====================== TOGGLE ITEM ======================
function toggle(itemId, secId, checked) {
  if (checked) selected.add(itemId); else selected.delete(itemId);
  const lbl = document.getElementById('item-' + itemId);
  if (lbl) lbl.classList.toggle('checked', checked);
  updateSecCount(secId);
  updatePrompt();
  saveLocalState();
}

function toggleCustom(itemId, secId, checked) {
  if (checked) selected.add(itemId); else selected.delete(itemId);
  const lbl = document.getElementById('citem-' + itemId);
  if (lbl) lbl.classList.toggle('checked', checked);
  updateSecCount(secId);
  updatePrompt();
  saveLocalState();
}

// ====================== SECTION COUNT ======================
function updateSecCount(secId) {
  const sec = DATA.find(s => s.id === secId);
  if (!sec) return;
  const presetN = sec.items.filter(i => selected.has(i.id)).length;
  const customN = (customItems[secId] || []).filter(i => selected.has(i.id)).length;
  const n = presetN + customN;
  const el = document.getElementById('cnt-' + secId);
  const secEl = document.getElementById('sec-' + secId);
  el.textContent = n;
  el.style.display = n > 0 ? 'inline-block' : 'none';
  secEl.classList.toggle('has-checked', n > 0);
}

// ====================== CUSTOM ITEMS ======================
function showAddForm(secId) {
  document.getElementById('add-form-' + secId).classList.add('open');
  document.getElementById('add-trig-' + secId).style.display = 'none';
  document.getElementById('add-label-' + secId).focus();
}
function hideAddForm(secId) {
  const form = document.getElementById('add-form-' + secId);
  form.classList.remove('open');
  document.getElementById('add-label-' + secId).value = '';
  document.getElementById('add-prompt-' + secId).value = '';
  document.getElementById('add-trig-' + secId).style.display = '';
}
function saveNew(secId) {
  const label = document.getElementById('add-label-' + secId).value.trim();
  const prompt = document.getElementById('add-prompt-' + secId).value.trim();
  if (!label || !prompt) return;
  if (!customItems[secId]) customItems[secId] = [];
  const id = 'c_' + secId + '_' + Date.now();
  customItems[secId].push({ id, label, prompt });
  hideAddForm(secId);
  renderCustomItems(secId);
  saveLocalState();
}
function removeCustom(secId, itemId) {
  if (!customItems[secId]) return;
  customItems[secId] = customItems[secId].filter(i => i.id !== itemId);
  selected.delete(itemId);
  updateSecCount(secId);
  renderCustomItems(secId);
  updatePrompt();
  saveLocalState();
}
function renderCustomItems(secId) {
  const wrap = document.getElementById('custom-wrap-' + secId);
  if (!wrap) return;
  const items = customItems[secId] || [];
  wrap.innerHTML = items.map(item => {
    const isChecked = selected.has(item.id);
    const preview = item.prompt.length > 45 ? item.prompt.substring(0, 45) + '…' : item.prompt;
    return `<label class="custom-item${isChecked ? ' checked' : ''}" id="citem-${item.id}">
      <input type="checkbox" id="ccb-${item.id}" ${isChecked ? 'checked' : ''} onchange="toggleCustom('${item.id}','${secId}',this.checked)">
      <div style="flex:1;min-width:0;">
        <div class="item-label">${escHtml(item.label)}</div>
        <div class="item-sub" style="word-break:break-all;">${escHtml(preview)}</div>
      </div>
      <button class="custom-del" onclick="event.preventDefault();removeCustom('${secId}','${item.id}')">✕</button>
    </label>`;
  }).join('');
}

// ====================== UPDATE PROMPT ======================
function updatePrompt() {
  const emptyEl = document.getElementById('empty-state');
  const blocksEl = document.getElementById('prompt-blocks');
  const statItems = document.getElementById('stat-items');
  const statChars = document.getElementById('stat-chars');
  const hchip = document.getElementById('header-chip');

  const ctx = { ...sharedCtx, ...personalCtx };
  const hasCtx = Object.values(ctx).some(v => v);
  const hasView = viewPromptActive && window._viewGeneratedPrompt;

  if (selected.size === 0 && !hasCtx && !hasView) {
    emptyEl.style.display = 'flex';
    blocksEl.innerHTML = '';
    statItems.textContent = '0';
    statChars.textContent = '0';
    hchip.textContent = '0개 선택됨';
    hchip.className = 'hchip';
    return;
  }

  emptyEl.style.display = 'none';
  let html = '';
  let totalChars = 0;

  // 컨텍스트 블록
  if (hasCtx) {
    const ctxLines = [];
    if (ctx.topic) ctxLines.push(`프로젝트 주제: ${ctx.topic}`);
    if (ctx.stack) ctxLines.push(`기술 스택: ${ctx.stack}`);
    if (ctx.rules) ctxLines.push(`팀 규칙/컨벤션: ${ctx.rules}`);
    if (ctx.extra) ctxLines.push(`추가 정보: ${ctx.extra}`);
    if (ctx.part)  ctxLines.push(`내가 맡은 파트: ${ctx.part}`);
    if (ctxLines.length) {
      ctxLines.forEach(l => { totalChars += l.length; });
      html += `<div class="pblock">
        <div class="psec-label">프로젝트 컨텍스트</div>
        ${ctxLines.map(l => `<div class="pline c-purple">${escHtml(l)}</div>`).join('')}
      </div>`;
    }
  }

  // 뷰 빌더 블록
  if (hasView) {
    const vp = window._viewGeneratedPrompt;
    totalChars += vp.prompt.length;
    html += `<div class="pblock">
      <div class="psec-label" style="color:var(--teal)">🎨 뷰 생성 요청</div>
      <div class="pline c-teal" style="white-space:pre-wrap">${escHtml(vp.prompt)}</div>
    </div>`;
  }

  DATA.forEach(sec => {
    const items = sec.items.filter(i => selected.has(i.id));
    const customs = (customItems[sec.id] || []).filter(i => selected.has(i.id));
    if (!items.length && !customs.length) return;

    html += `<div class="pblock">
      <div class="psec-label">${sec.title}</div>
      ${items.map(i => {
        totalChars += i.prompt.length;
        return `<div class="pline ${sec.colorClass}">${escHtml(i.prompt)}</div>`;
      }).join('')}
      ${customs.map(i => {
        totalChars += i.prompt.length;
        return `<div class="pline ${sec.colorClass}">${escHtml(i.prompt)}</div>`;
      }).join('')}
    </div>`;
  });

  // 추가 입력 블록
  const extra = getExtraInput();
  if (extra) {
    totalChars += extra.length;
    html += `<div class="pblock">
      <div class="psec-label" style="color:var(--amber)">✏️ 추가 입력</div>
      <div class="pline c-amber" style="white-space:pre-wrap">${escHtml(extra)}</div>
    </div>`;
  }

  blocksEl.innerHTML = html;
  const totalItems = selected.size + (hasView ? 1 : 0);
  statItems.textContent = totalItems;
  statChars.textContent = totalChars;
  hchip.textContent = `${totalItems}개 선택됨`;
  hchip.className = 'hchip active';
}

// ====================== COPY / CLEAR ======================
function buildFullPrompt(withHeaders) {
  const parts = [];
  const ctx = { ...sharedCtx, ...personalCtx };
  const hasCtx = Object.values(ctx).some(v => v);
  const hasView = viewPromptActive && window._viewGeneratedPrompt;

  if (hasCtx) {
    const ctxLines = [];
    if (ctx.topic) ctxLines.push(`프로젝트 주제: ${ctx.topic}`);
    if (ctx.stack) ctxLines.push(`기술 스택: ${ctx.stack}`);
    if (ctx.rules) ctxLines.push(`팀 규칙/컨벤션: ${ctx.rules}`);
    if (ctx.extra) ctxLines.push(`추가 정보: ${ctx.extra}`);
    if (ctx.part)  ctxLines.push(`내가 맡은 파트: ${ctx.part}`);
    if (ctxLines.length) {
      if (withHeaders) parts.push(`## 프로젝트 컨텍스트\n${ctxLines.join('\n')}`);
      else parts.push(ctxLines.join('\n'));
    }
  }

  if (hasView) {
    const vp = window._viewGeneratedPrompt;
    if (withHeaders) parts.push(`## 🎨 뷰 생성 요청\n${vp.prompt}`);
    else parts.push(vp.prompt);
  }

  DATA.forEach(sec => {
    const items = sec.items.filter(i => selected.has(i.id));
    const customs = (customItems[sec.id] || []).filter(i => selected.has(i.id));
    if (!items.length && !customs.length) return;
    const texts = [...items.map(i => i.prompt), ...customs.map(i => i.prompt)];
    if (withHeaders) parts.push(`## ${sec.title}\n${texts.join('\n')}`);
    else parts.push(texts.join('\n'));
  });
  const extra = getExtraInput();
  if (extra) {
    if (withHeaders) parts.push(`## ✏️ 추가 입력\n${extra}`);
    else parts.push(extra);
  }
  return parts.join('\n\n');
}

function copyFull() {
  const prompt = buildFullPrompt(true);
  if (!prompt) return;
  navigator.clipboard.writeText(prompt).then(() => {
    showToast();
    recordActivity();
  });
}
function copyRaw() {
  const prompt = buildFullPrompt(false);
  if (!prompt) return;
  navigator.clipboard.writeText(prompt).then(() => {
    showToast();
    recordActivity();
  });
}

function recordActivity() {
  if (!currentWs || currentWs.type !== 'team') return;
  const tags = makeFeedTags();
  if (!tags.length) return;
  const part = personalCtx.part || '익명';
  const item = { part, tags, ts: Date.now() };
  saveFeedItem(currentWs.id, item);
}
function clearAll() {
  selected.clear();
  viewPromptActive = false;
  window._viewGeneratedPrompt = null;
  viewMoodsSelected.clear();
  // 뷰 빌더 입력 초기화
  ['view-page-name','view-page-desc','view-tech','view-features','view-api','view-ref-link'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.querySelectorAll('.mood-chip').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
  document.querySelectorAll('.item, .custom-item').forEach(el => el.classList.remove('checked'));
  DATA.forEach(sec => updateSecCount(sec.id));
  const extraEl = document.getElementById('extra-input');
  if (extraEl) extraEl.value = '';
  try { localStorage.removeItem(VIEW_BUILDER_KEY); } catch(e) {}
  updatePrompt();
  saveLocalState();
}

function clearExtra() {
  const el = document.getElementById('extra-input');
  if (el) el.value = '';
  updatePrompt();
}

function getExtraInput() {
  return document.getElementById('extra-input')?.value.trim() || '';
}
function showToast() { showToastMsg('✓ 클립보드에 복사됨'); }
function showToastMsg(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}
function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ====================== WORKSPACE SWITCH ======================
async function resetToWs(ws) {
  // 상태 초기화
  selected.clear();
  Object.keys(customItems).forEach(k => delete customItems[k]);
  sharedCtx = {};
  personalCtx = {};
  viewPromptActive = false;
  window._viewGeneratedPrompt = null;

  // 새 워크스페이스 데이터 로드
  loadLocalState();
  loadPersonalCtx();
  await loadSharedCtx();

  fillInputsFromCtx();
  updateBanner();

  // 컨텍스트 패널 상태
  const hasCtx = Object.values(sharedCtx).some(v => v) || Object.values(personalCtx).some(v => v);
  const panel = document.getElementById('context-panel');
  const chev  = document.getElementById('ctx-chevron');
  ctxPanelOpen = !hasCtx;
  panel.classList.toggle('collapsed', !ctxPanelOpen);
  chev.classList.toggle('open', ctxPanelOpen);

  // 싱크 뱃지 타입 반영
  const badge = document.getElementById('sync-badge');
  if (ws.type === 'solo') {
    badge.textContent = '🔒 개인 전용';
    badge.className = 'sync-badge personal';
  } else {
    badge.textContent = '🔗 공유됨';
    badge.className = 'sync-badge shared';
  }

  buildOptions();
  updatePrompt();
}

// ====================== INIT ======================
async function init() {
  loadViewBuilder();

  // 마지막으로 쓴 워크스페이스 복원
  let wsId = null;
  try { wsId = localStorage.getItem(WS_CURRENT_KEY); } catch(e) {}

  const list = loadWsList();

  if (wsId) {
    const found = list.find(w => w.id === wsId);
    if (found) {
      currentWs = found;
      updateWsHeader();
      closeWsOverlay();
      await resetToWs(found);
      return;
    }
  }

  // 저장된 ws 없으면 오버레이 표시
  if (list.length === 0) {
    // 첫 사용자 → 오버레이 열기
    openWsOverlay();
    // 그래도 기본 UI는 렌더
    buildOptions();
    updatePrompt();
  } else {
    // 목록은 있는데 current 없음 → 목록 보여주기
    openWsOverlay();
    buildOptions();
    updatePrompt();
  }
}

init();
