/* =========================================================
   WORK · EDITORIAL LIST VIEW
   Inspiration: marinkurir.com
   Replaces the work grid with a long-form numbered list.
   Reads from the existing `projects` + `projectOrder` data.
   Hover any row → image preview floats with the cursor.
   ========================================================= */
(function(){
  if (typeof projects === 'undefined' || typeof projectOrder === 'undefined') return;
  var grid = document.getElementById('workGrid');
  if (!grid) return;

  // Hide the old card grid
  grid.style.display = 'none';

  // Build the editorial list
  var list = document.createElement('section');
  list.className = 'work-editorial';
  list.id = 'workEditorial';

  // Header
  var headerRow = document.createElement('div');
  headerRow.className = 'we-header';
  headerRow.innerHTML = '\
    <span class="we-h-num">№</span>\
    <span class="we-h-year">Year</span>\
    <span class="we-h-title">Project</span>\
    <span class="we-h-role">Role · Tags</span>\
    <span class="we-h-cta"></span>';
  list.appendChild(headerRow);

  // Build a category lookup from the existing grid so the filter still works
  var categories = {};
  document.querySelectorAll('.work-card[data-project]').forEach(function(card){
    categories[card.dataset.project] = card.dataset.category || 'design';
  });

  // Cover-image lookup — grab the first image from each project's images array
  function coverFor(id){
    var p = projects[id];
    if (!p) return null;
    if (p.images && p.images.length) return p.images[0];
    return null;
  }

  // Hero color for projects without images (text-card style)
  var palette = {
    inkwell: ['#f0eee9', 'oklch(0.16 0.012 260)'],
    agora:   ['oklch(0.16 0.012 260)', 'oklch(0.42 0.21 265)'],
    handcursor: ['oklch(0.16 0.012 260)', 'oklch(0.42 0.21 265)'],
    dropballs:  ['oklch(0.16 0.012 260)', 'oklch(0.42 0.21 265)'],
    cigarette: ['oklch(0.16 0.012 260)', 'oklch(0.42 0.21 265)'],
    vijay:     ['oklch(0.16 0.012 260)', 'oklch(0.42 0.21 265)'],
    razer:     ['oklch(0.16 0.012 260)', 'oklch(0.42 0.21 265)']
  };

  projectOrder.forEach(function(id, idx){
    var p = projects[id];
    if (!p) return;
    var num = String(idx + 1).padStart(2, '0');
    var year = (p.year || '').split('—')[0].trim() || (p.year || '');
    var role = (p.role || '').split('·')[0].split('/')[0].trim();
    var tags = (p.tags || []).slice(0, 2).join(' · ');
    var cover = coverFor(id);
    var cat = categories[id] || 'design';
    var isExternalLink = p.cta && p.cta.href && /^https?:/.test(p.cta.href);

    var row = document.createElement('a');
    row.className = 'we-row';
    row.dataset.project = id;
    row.dataset.category = cat;
    row.href = isExternalLink ? p.cta.href : ('#' + id);
    if (isExternalLink){ row.target = '_blank'; row.rel = 'noopener'; }
    row.setAttribute('data-cover', cover || '');

    row.innerHTML = '\
      <span class="we-num">' + num + '</span>\
      <span class="we-year">' + (year || '—') + '</span>\
      <span class="we-title">' + (p.title || id) + '</span>\
      <span class="we-role">' + (role ? role : '') + (tags ? ' · ' + tags : '') + '</span>\
      <span class="we-cta">View →</span>';

    // Wire same handler the grid uses — open the project panel
    row.addEventListener('click', function(e){
      if (isExternalLink) return; // let external go
      if (e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      if (typeof openPanel === 'function') openPanel(id);
      else window.location.hash = id;
    });

    list.appendChild(row);
  });

  // Insert the list right where the grid was
  grid.parentNode.insertBefore(list, grid);

  // ---- Hover image preview (Marin Kurir-flavoured) ----
  var preview = document.createElement('div');
  preview.className = 'we-preview';
  preview.innerHTML = '<img alt="" />';
  document.body.appendChild(preview);
  var previewImg = preview.querySelector('img');
  var currentSrc = '';
  var mx = 0, my = 0, raf = null;

  function showPreview(src){
    if (src === currentSrc && preview.classList.contains('is-on')) return;
    currentSrc = src;
    if (!src){ preview.classList.remove('is-on'); return; }
    previewImg.src = src;
    preview.classList.add('is-on');
  }
  function hidePreview(){
    preview.classList.remove('is-on');
    currentSrc = '';
  }
  function updatePreviewPos(){
    preview.style.transform = 'translate3d(' + (mx + 28) + 'px, ' + (my - 100) + 'px, 0)';
    raf = null;
  }
  document.addEventListener('mousemove', function(e){
    mx = e.clientX; my = e.clientY;
    if (!raf) raf = requestAnimationFrame(updatePreviewPos);
  });
  list.querySelectorAll('.we-row').forEach(function(row){
    row.addEventListener('mouseenter', function(){
      var src = row.getAttribute('data-cover');
      showPreview(src);
    });
    row.addEventListener('mouseleave', function(){
      hidePreview();
    });
  });

  // ---- Filter pill compatibility ----
  // Override the existing filter to also drive editorial rows
  document.querySelectorAll('.filter-pill').forEach(function(pill){
    pill.addEventListener('click', function(){
      var filter = this.dataset.filter;
      list.querySelectorAll('.we-row').forEach(function(row){
        var show = filter === 'all' || row.dataset.category === filter;
        row.style.display = show ? '' : 'none';
      });
    });
  });

  // Apply ?filter= query param on load
  var urlFilter = new URLSearchParams(window.location.search).get('filter');
  if (urlFilter && ['design','marketing','systems'].includes(urlFilter)){
    list.querySelectorAll('.we-row').forEach(function(row){
      if (row.dataset.category !== urlFilter) row.style.display = 'none';
    });
  }
})();
