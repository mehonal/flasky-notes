/**
 * Flasky Notes — Agenda view module.
 *
 * All document-level listeners are bound to the view container so they can
 * be removed on destroy(). The {% if ai_enabled %} Jinja guard becomes a
 * runtime check on whether #aiPanel exists in the container.
 */
(function () {
    'use strict';

    var _root = null;
    var _bound = [];
    var _docBound = [];
    var _autosaveTimer = null;
    var _summaryObserver = null;
    var _summaryTimer = null;
    var _aiSlashDropdown = null;
    var _aiAbortController = null;

    function bind(el, ev, fn, opts) {
        if (!el) return;
        el.addEventListener(ev, fn, opts);
        _bound.push([el, ev, fn, opts]);
    }
    function bindDoc(el, ev, fn, opts) {
        el.addEventListener(ev, fn, opts);
        _docBound.push([el, ev, fn, opts]);
    }
    function unbindAll() {
        _bound.forEach(function (b) { b[0].removeEventListener(b[1], b[2], b[3]); });
        _docBound.forEach(function (b) { b[0].removeEventListener(b[1], b[2], b[3]); });
        _bound = [];
        _docBound = [];
    }

    function init(container) {
        _root = container.querySelector('#agenda-root');
        if (!_root) return;

        var lastSavedContent = document.getElementById('agenda-notes').value;
        var currentFilter = 'all';
        var aiConversationId = null;
        var aiLocalMessages = [];
        var aiIsStreaming = false;
        var aiAgendaContext = null;
        var aiStreamCallback = null;

        // ============ E2EE init ============
        (async function () {
            if (typeof FlaskyE2EE !== 'undefined') {
                var ok = await FlaskyE2EE.init();
                if (!ok) return;
                var todoPromises = [];
                _root.querySelectorAll('.todo-label').forEach(function (el) {
                    todoPromises.push((async function () {
                        try { el.childNodes[0].textContent = await FlaskyE2EE.decryptField(el.childNodes[0].textContent.trim()); } catch (e) {}
                    })());
                });
                var eventPromises = [];
                _root.querySelectorAll('.event-label').forEach(function (el) {
                    eventPromises.push((async function () {
                        try { el.childNodes[0].textContent = await FlaskyE2EE.decryptField(el.childNodes[0].textContent.trim()); } catch (e) {}
                    })());
                });
                var archivedPromises = [];
                _root.querySelectorAll('.archived-item-title').forEach(function (el) {
                    archivedPromises.push((async function () {
                        try { el.textContent = await FlaskyE2EE.decryptField(el.textContent.trim()); } catch (e) {}
                    })());
                });
                var notePromises = [];
                _root.querySelectorAll('.sidebar-nav .nav-item-title').forEach(function (el) {
                    notePromises.push((async function () {
                        try { el.textContent = await FlaskyE2EE.decryptField(el.textContent.trim()); } catch (e) {}
                    })());
                });
                await Promise.all(todoPromises.concat(eventPromises).concat(archivedPromises).concat(notePromises));
                _root.classList.add('e2ee-decrypted');
            }
        })();

        // ============ Modal system ============
        function showModal(id) { document.getElementById(id).classList.add('visible'); }
        function hideModal(id) {
            document.getElementById(id).classList.remove('visible');
            if (id === 'addTodoOverlay' || id === 'addEventOverlay') {
                var overlay = document.getElementById(id);
                overlay.querySelectorAll('input[type="text"], input[type="date"], input[type="time"]').forEach(function (i) { i.value = ''; });
                overlay.querySelectorAll('textarea').forEach(function (t) { t.value = ''; });
            }
        }

        _root.querySelectorAll('.modal-overlay').forEach(function (overlay) {
            bind(overlay, 'click', function (e) { if (e.target === overlay) hideModal(overlay.id); });
        });

        bindDoc(document, 'keydown', function (e) {
            if (e.key === 'Escape') {
                _root.querySelectorAll('.modal-overlay.visible').forEach(function (o) { hideModal(o.id); });
            }
        });

        // ============ Sidebar ============
        function toggleSidebar() {
            var sidebar = document.getElementById('sidebar');
            var backdrop = document.getElementById('sidebar-backdrop');
            sidebar.classList.toggle('collapsed');
            if (window.innerWidth <= 768) backdrop.classList.toggle('visible');
        }

        if (window.innerWidth <= 768) {
            document.getElementById('sidebar').classList.add('collapsed');
        }

        // ============ Theme ============
        function toggleTheme() {
            var html = document.documentElement;
            var isDark = html.getAttribute('data-theme') === 'dark';
            html.setAttribute('data-theme', isDark ? 'light' : 'dark');
            var label = document.getElementById('theme-label');
            if (label) label.innerText = isDark ? 'Light' : 'Dark';
            fetch('/api/save_dark_mode/' + (isDark ? '0' : '1'));
            var darkCSS = document.getElementById('hljs-dark');
            var lightCSS = document.getElementById('hljs-light');
            if (darkCSS && lightCSS) {
                darkCSS.disabled = !isDark;
                lightCSS.disabled = isDark;
            }
        }

        // ============ Toast ============
        function showToast(message, type) {
            type = type || 'success';
            var containerEl = document.getElementById('toast-container');
            if (!containerEl) return;
            var toast = document.createElement('div');
            toast.className = 'toast ' + type;
            toast.innerHTML =
                '<span>' + escapeHtml(message) + '</span>' +
                '<button class="toast-close" data-action="dismiss-toast">' +
                '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
                '</button>';
            containerEl.appendChild(toast);
            setTimeout(function () { if (toast.parentElement) toast.remove(); }, 3000);
        }

        // ============ Autosave ============
        bind(document.getElementById('agenda-notes'), 'input', function () {
            if (_autosaveTimer) clearTimeout(_autosaveTimer);
            document.getElementById('autosave-status').innerText = 'Unsaved changes...';
            _autosaveTimer = setTimeout(function () {
                var currentContent = document.getElementById('agenda-notes').value;
                if (currentContent !== lastSavedContent) saveNotes(true);
            }, 3000);
        });

        // ============ Todo filter ============
        function filterTodos(filter) {
            currentFilter = filter;
            _root.querySelectorAll('.filter-pill').forEach(function (btn) { btn.classList.remove('active'); });
            _root.querySelector('.filter-pill[data-filter="' + filter + '"]').classList.add('active');
            var todos = _root.querySelectorAll('#todo-list .todo-item');
            var visibleCount = 0;
            todos.forEach(function (item) {
                var isCompleted = item.dataset.completed === 'true';
                if (filter === 'all' || (filter === 'pending' && !isCompleted) || (filter === 'done' && isCompleted)) {
                    item.style.display = ''; visibleCount++;
                } else { item.style.display = 'none'; }
            });
            var emptyState = _root.querySelector('#todo-list .todo-empty-state');
            if (visibleCount === 0 && todos.length > 0) {
                if (!emptyState) {
                    emptyState = document.createElement('div');
                    emptyState.className = 'empty-state todo-empty-state';
                    document.getElementById('todo-list').appendChild(emptyState);
                }
                emptyState.style.display = '';
                emptyState.innerText = filter === 'pending' ? 'No pending to-dos.' : 'No completed to-dos.';
            } else if (emptyState && todos.length > 0) {
                emptyState.style.display = 'none';
            }
        }

        // ============ Confirm delete ============
        function confirmDeleteTodo(event) {
            var btn = event.target.closest('.action-btn');
            var todoId = btn.dataset.todoId;
            var listItem = btn.closest('.list-item');
            document.getElementById('confirmDeleteMessage').innerText = 'Delete this to-do item?';
            showModal('confirmDeleteOverlay');
            document.getElementById('confirmDeleteBtn').onclick = function () {
                deleteTodo(todoId);
                listItem.remove();
                updateTodoEmptyState();
                updateSummaryBar();
                hideModal('confirmDeleteOverlay');
                showToast('To-do deleted.');
            };
        }

        function confirmDeleteEvent(event) {
            var btn = event.target.closest('.action-btn');
            var eventId = btn.dataset.eventId;
            var listItem = btn.closest('.list-item');
            document.getElementById('confirmDeleteMessage').innerText = 'Delete this event?';
            showModal('confirmDeleteOverlay');
            document.getElementById('confirmDeleteBtn').onclick = function () {
                deleteEvent(eventId);
                listItem.remove();
                updateEventEmptyState();
                updateSummaryBar();
                hideModal('confirmDeleteOverlay');
                showToast('Event deleted.');
            };
        }

        function updateTodoEmptyState() {
            var todos = _root.querySelectorAll('#todo-list .todo-item');
            var emptyState = _root.querySelector('#todo-list .todo-empty-state');
            if (todos.length === 0) {
                if (!emptyState) {
                    emptyState = document.createElement('div');
                    emptyState.className = 'empty-state todo-empty-state';
                    emptyState.innerText = 'No to-do items yet. Add one above!';
                    document.getElementById('todo-list').appendChild(emptyState);
                }
                emptyState.style.display = '';
            } else if (emptyState) { emptyState.style.display = 'none'; }
        }

        function updateEventEmptyState() {
            var events = _root.querySelectorAll('#event-list .event-item');
            var emptyState = _root.querySelector('#event-list .event-empty-state');
            if (events.length === 0) {
                if (!emptyState) {
                    emptyState = document.createElement('div');
                    emptyState.className = 'empty-state event-empty-state';
                    emptyState.innerText = 'No upcoming events. Add one above!';
                    document.getElementById('event-list').appendChild(emptyState);
                }
                emptyState.style.display = '';
            } else if (emptyState) { emptyState.style.display = 'none'; }
        }

        // ============ Toggle todo ============
        function toggleTodoItem(event) {
            var listItem = event.target.closest('.todo-item');
            var spanEl = listItem.querySelector('.todo-label');
            spanEl.classList.toggle('completed', event.target.checked);
            listItem.dataset.completed = event.target.checked ? 'true' : 'false';
            fetch('/api/toggle_todo', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ toDoId: spanEl.dataset.todoId })
            }).catch(function () { showToast('Failed to update to-do.', 'danger'); });
            if (currentFilter !== 'all') filterTodos(currentFilter);
            setTimeout(updateSummaryBar, 50);
        }

        // ============ Archived todos ============
        async function showArchivedTodosModal() {
            showModal('archivedTodosOverlay');
            document.getElementById('archivedTodosLoading').style.display = '';
            document.getElementById('archivedTodosEmpty').style.display = 'none';
            document.getElementById('archivedTodosList').innerHTML = '';
            fetch('/api/get_todos?archived=true')
                .then(function (r) { return r.json(); })
                .then(async function (data) {
                    if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
                        for (var i = 0; i < data.length; i++) {
                            try { data[i].title = await FlaskyE2EE.decryptField(data[i].title); } catch (e) {}
                        }
                    }
                    document.getElementById('archivedTodosLoading').style.display = 'none';
                    if (data.length === 0) { document.getElementById('archivedTodosEmpty').style.display = ''; return; }
                    var list = document.getElementById('archivedTodosList');
                    data.forEach(function (todo) {
                        var item = document.createElement('div');
                        item.className = 'archived-item';
                        item.innerHTML =
                            '<span class="archived-item-title">' + escapeHtml(todo.title) + '</span>' +
                            '<div class="archived-item-actions">' +
                            '<button class="action-btn" data-action="unarchive-todo" data-id="' + todo.id + '" title="Restore">' +
                            '<svg viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>' +
                            '<button class="action-btn danger" data-todo-id="' + todo.id + '" data-action="delete-archived-todo" title="Delete">' +
                            '<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>' +
                            '</div>';
                        list.appendChild(item);
                    });
                })
                .catch(function () {
                    document.getElementById('archivedTodosLoading').style.display = 'none';
                    showToast('Failed to load archived to-dos.', 'danger');
                });
        }

        // ============ Past events ============
        async function showPastEventsModal() {
            showModal('pastEventsOverlay');
            document.getElementById('pastEventsLoading').style.display = '';
            document.getElementById('pastEventsEmpty').style.display = 'none';
            document.getElementById('pastEventsList').innerHTML = '';
            fetch('/api/get_events?past=true')
                .then(function (r) { return r.json(); })
                .then(async function (data) {
                    if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
                        for (var i = 0; i < data.length; i++) {
                            try { data[i].title = await FlaskyE2EE.decryptField(data[i].title); } catch (e) {}
                        }
                    }
                    document.getElementById('pastEventsLoading').style.display = 'none';
                    if (data.length === 0) { document.getElementById('pastEventsEmpty').style.display = ''; return; }
                    var list = document.getElementById('pastEventsList');
                    data.forEach(function (ev) {
                        var item = document.createElement('div');
                        item.className = 'archived-item';
                        var dateStr = '';
                        if (ev.date_of_event) dateStr = ' <span class="badge badge-secondary">' + escapeHtml(new Date(ev.date_of_event).toLocaleDateString()) + '</span>';
                        item.innerHTML =
                            '<span class="archived-item-title">' + escapeHtml(ev.title) + dateStr + '</span>' +
                            '<div class="archived-item-actions">' +
                            '<button class="action-btn danger" data-event-id="' + ev.id + '" data-action="delete-past-event" title="Delete">' +
                            '<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>' +
                            '</div>';
                        list.appendChild(item);
                    });
                })
                .catch(function () {
                    document.getElementById('pastEventsLoading').style.display = 'none';
                    showToast('Failed to load past events.', 'danger');
                });
        }

        function deletePastEvent(event) {
            var btn = event.target.closest('.action-btn');
            deleteEvent(btn.dataset.eventId);
            btn.closest('.archived-item').remove();
        }

        // ============ Show modals ============
        function showAddTodoModal() { showModal('addTodoOverlay'); }
        function showAddEventModal() { showModal('addEventOverlay'); }

        function _extractTime(isoStr) {
            if (!isoStr) return '';
            try {
                var d = new Date(isoStr);
                if (isNaN(d.getTime())) return '';
                var h = String(d.getHours()).padStart(2, '0');
                var m = String(d.getMinutes()).padStart(2, '0');
                return h + ':' + m;
            } catch (e) { return ''; }
        }

        async function showTodoDetailsModal(id) {
            showModal('todoDetailsOverlay');
            document.getElementById('todoDetailsLoading').style.display = '';
            document.getElementById('todoDetailsFields').style.display = 'none';
            try {
                var data = await fetch('/api/get_todo/' + id).then(function (r) { return r.json(); });
                if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
                    try { data.todo.title = await FlaskyE2EE.decryptField(data.todo.title); } catch (e) {}
                    try { data.todo.content = await FlaskyE2EE.decryptField(data.todo.content); } catch (e) {}
                }
                document.getElementById('todoDetailsLoading').style.display = 'none';
                document.getElementById('todoDetailsFields').style.display = '';
                document.getElementById('todoDetailsModalLabel').innerText = data.todo.title;
                document.getElementById('todoDetailsModalLabel').dataset.todoId = data.todo.id;
                document.getElementById('todoDetailsModalLabel').dataset.todoArchived = data.todo.archived;
                document.querySelector('#todoDetailsFields input[type="text"]').value = data.todo.title;
                document.querySelector('#todoDetailsFields input[type="date"]').value = data.todo.date_due ? new Date(data.todo.date_due).toISOString().split('T')[0] : '';
                document.querySelector('#todoDetailsFields input[type="time"]').value = data.todo.date_due ? _extractTime(data.todo.date_due) : '';
                document.querySelector('#todoDetailsFields textarea').value = data.todo.content;
            } catch (e) {
                document.getElementById('todoDetailsLoading').style.display = 'none';
                showToast('Failed to load to-do details.', 'danger');
            }
        }

        async function showEventDetailsModal(id) {
            showModal('eventDetailsOverlay');
            document.getElementById('eventDetailsLoading').style.display = '';
            document.getElementById('eventDetailsFields').style.display = 'none';
            try {
                var data = await fetch('/api/get_event/' + id).then(function (r) { return r.json(); });
                if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
                    try { data.event.title = await FlaskyE2EE.decryptField(data.event.title); } catch (e) {}
                    try { data.event.content = await FlaskyE2EE.decryptField(data.event.content); } catch (e) {}
                }
                document.getElementById('eventDetailsLoading').style.display = 'none';
                document.getElementById('eventDetailsFields').style.display = '';
                document.getElementById('eventDetailsModalLabel').innerText = data.event.title;
                document.getElementById('eventDetailsModalLabel').dataset.eventId = data.event.id;
                document.querySelector('#eventDetailsFields input[type="text"]').value = data.event.title;
                document.querySelector('#eventDetailsFields input[type="date"]').value = data.event.date_of_event ? new Date(data.event.date_of_event).toISOString().split('T')[0] : '';
                document.querySelector('#eventDetailsFields input[type="time"]').value = data.event.date_of_event ? _extractTime(data.event.date_of_event) : '';
                document.querySelector('#eventDetailsFields textarea').value = data.event.content;
            } catch (e) {
                document.getElementById('eventDetailsLoading').style.display = 'none';
                showToast('Failed to load event details.', 'danger');
            }
        }

        // ============ CRUD ============
        function archiveTodo(event) {
            var btn = event.target.closest('.action-btn');
            fetch('/api/archive_todo', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ toDoId: btn.dataset.todoId })
            }).then(function (r) { return r.json(); }).then(function () {
                btn.closest('.list-item').remove();
                updateTodoEmptyState();
                updateSummaryBar();
                showToast('To-do archived.');
            }).catch(function () { showToast('Failed to archive to-do.', 'danger'); });
        }

        function unarchiveTodo(id) {
            fetch('/api/unarchive_todo', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ toDoId: id })
            }).then(function (r) { return r.json(); }).then(function (data) {
                var todoList = document.getElementById('todo-list');
                todoList.appendChild(bakeTodoDOM(data.todo));
                var emptyState = _root.querySelector('#todo-list .todo-empty-state');
                if (emptyState) emptyState.style.display = 'none';
                hideModal('archivedTodosOverlay');
                showToast('To-do restored.');
            }).catch(function () { showToast('Failed to restore to-do.', 'danger'); });
        }

        function deleteTodo(id) {
            fetch('/api/delete_todo', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ toDoId: id })
            }).catch(function () { showToast('Failed to delete to-do.', 'danger'); });
        }

        function deleteTodoFromEvent(event) {
            var btn = event.target.closest('.action-btn');
            deleteTodo(btn.dataset.todoId);
            btn.closest('.archived-item').remove();
        }

        function deleteEvent(id) {
            fetch('/api/delete_event', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ eventId: id })
            }).catch(function () { showToast('Failed to delete event.', 'danger'); });
        }

        async function saveTodoFromModal() {
            var todoId = document.getElementById('todoDetailsModalLabel').dataset.todoId;
            var todoTitle = document.querySelector('#todoDetailsFields input[type="text"]').value;
            var todoDate = document.querySelector('#todoDetailsFields input[type="date"]').value;
            var todoTime = document.querySelector('#todoDetailsFields input[type="time"]').value;
            var todoContent = document.querySelector('#todoDetailsFields textarea').value;
            var dateDue = todoDate;
            if (todoDate && todoTime) dateDue = todoDate + 'T' + todoTime;
            var encTitle = todoTitle, encContent = todoContent;
            if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
                encTitle = await FlaskyE2EE.encryptField(todoTitle);
                encContent = await FlaskyE2EE.encryptField(todoContent);
            }
            fetch('/api/edit_todo', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ toDoId: todoId, title: encTitle, content: encContent, dateDue: dateDue })
            }).then(function (r) { return r.json(); }).then(function (data) {
                var todoItem = _root.querySelector('span[data-todo-id="' + todoId + '"]');
                if (todoItem) {
                    var text = escapeHtml(todoTitle);
                    if (todoContent) text += ' <span style="opacity:0.5">...</span>';
                    if (todoDate) {
                        text += ' <span class="badge badge-' + escapeHtml(data.todo.due_css_class) + '">' + escapeHtml(data.todo.time_until_due) + '</span>';
                        if (data.todo.formatted_due_time) text += ' <span class="item-time">' + escapeHtml(data.todo.formatted_due_time) + '</span>';
                    }
                    todoItem.innerHTML = text;
                }
                var todoRow = todoItem ? todoItem.closest('.todo-item') : null;
                if (todoRow && todoDate) todoRow.dataset.date = dateDue;
                else if (todoRow && !todoDate) delete todoRow.dataset.date;
                hideModal('todoDetailsOverlay');
                updateSummaryBar();
                showToast('To-do saved.');
            }).catch(function () { showToast('Failed to save to-do.', 'danger'); });
        }

        async function saveEventFromModal() {
            var eventId = document.getElementById('eventDetailsModalLabel').dataset.eventId;
            var eventTitle = document.querySelector('#eventDetailsFields input[type="text"]').value;
            var eventDate = document.querySelector('#eventDetailsFields input[type="date"]').value;
            var eventTime = document.querySelector('#eventDetailsFields input[type="time"]').value;
            var eventContent = document.querySelector('#eventDetailsFields textarea').value;
            var dateOfEvent = eventDate;
            if (eventDate && eventTime) dateOfEvent = eventDate + 'T' + eventTime;
            var encTitle = eventTitle, encContent = eventContent;
            if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
                encTitle = await FlaskyE2EE.encryptField(eventTitle);
                encContent = await FlaskyE2EE.encryptField(eventContent);
            }
            fetch('/api/edit_event', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ eventId: eventId, title: encTitle, content: encContent, dateOfEvent: dateOfEvent })
            }).then(function (r) { return r.json(); }).then(function (data) {
                var eventItem = _root.querySelector('span[data-event-id="' + eventId + '"]');
                if (eventItem) {
                    var text = escapeHtml(eventTitle);
                    if (eventContent) text += ' <span style="opacity:0.5">...</span>';
                    if (eventDate) {
                        text += ' <span class="badge badge-' + escapeHtml(data.event.event_css_class) + '">' + escapeHtml(data.event.time_until_event) + '</span>';
                        if (data.event.formatted_event_time) text += ' <span class="item-time">' + escapeHtml(data.event.formatted_event_time) + '</span>';
                    }
                    eventItem.innerHTML = text;
                }
                var eventRow = eventItem ? eventItem.closest('.event-item') : null;
                if (eventRow && eventDate) eventRow.dataset.date = dateOfEvent;
                else if (eventRow && !eventDate) delete eventRow.dataset.date;
                hideModal('eventDetailsOverlay');
                updateSummaryBar();
                showToast('Event saved.');
            }).catch(function () { showToast('Failed to save event.', 'danger'); });
        }

        // ============ DOM builders ============
        function bakeTodoDOM(todo) {
            var item = document.createElement('div');
            item.className = 'list-item todo-item';
            item.dataset.completed = todo.completed ? 'true' : 'false';
            if (todo.date_due) item.dataset.date = todo.date_due;
            var badgeHtml = '';
            if (todo.time_until_due) badgeHtml = ' <span class="badge badge-' + escapeHtml(todo.due_css_class) + '">' + escapeHtml(todo.time_until_due) + '</span>';
            if (todo.formatted_due_time) badgeHtml += ' <span class="item-time">' + escapeHtml(todo.formatted_due_time) + '</span>';
            var contentHint = todo.has_content ? ' <span style="opacity:0.5">...</span>' : '';
            item.innerHTML =
                '<div class="list-item-left">' +
                '<input type="checkbox" class="todo-checkbox" ' + (todo.completed ? 'checked' : '') + ' />' +
                '<span data-todo-id="' + todo.id + '" class="todo-label' + (todo.completed ? ' completed' : '') + '" data-action="show-todo-details" data-id="' + todo.id + '">' + escapeHtml(todo.title) + contentHint + badgeHtml + '</span>' +
                '</div>' +
                '<div class="list-item-right">' +
                '<button class="action-btn warning" data-todo-id="' + todo.id + '" data-action="archive-todo" title="Archive"><svg viewBox="0 0 24 24"><path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/></svg></button>' +
                '<button class="action-btn danger" data-todo-id="' + todo.id + '" data-action="confirm-delete-todo" title="Delete"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>' +
                '</div>';
            return item;
        }

        function bakeEventDOM(event) {
            var item = document.createElement('div');
            item.className = 'list-item event-item';
            if (event.date_of_event) item.dataset.date = event.date_of_event;
            var badgeHtml = '';
            if (event.time_until_event) badgeHtml = ' <span class="badge badge-' + escapeHtml(event.event_css_class) + '">' + escapeHtml(event.time_until_event) + '</span>';
            if (event.formatted_event_time) badgeHtml += ' <span class="item-time">' + escapeHtml(event.formatted_event_time) + '</span>';
            var contentHint = event.has_content ? ' <span style="opacity:0.5">...</span>' : '';
            item.innerHTML =
                '<div class="list-item-left">' +
                '<span data-event-id="' + event.id + '" class="event-label" data-action="show-event-details" data-id="' + event.id + '">' + escapeHtml(event.title) + contentHint + badgeHtml + '</span>' +
                '</div>' +
                '<div class="list-item-right">' +
                '<button class="action-btn danger" data-event-id="' + event.id + '" data-action="confirm-delete-event" title="Delete"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>' +
                '</div>';
            return item;
        }

        // ============ Add from modal ============
        async function addTodoFromModal() {
            var title = document.querySelector('#addTodoOverlay input[type="text"]').value;
            var date = document.querySelector('#addTodoOverlay input[type="date"]').value;
            var time = document.querySelector('#addTodoOverlay input[type="time"]').value;
            var content = document.querySelector('#addTodoOverlay textarea').value;
            if (!title || title.trim().length < 2) { showToast('Please enter a valid to-do title.', 'warning'); return; }
            var dateDue = date;
            if (date && time) dateDue = date + 'T' + time;
            var encTitle = title, encContent = content;
            if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
                encTitle = await FlaskyE2EE.encryptField(title);
                encContent = await FlaskyE2EE.encryptField(content);
            }
            fetch('/api/add_todo', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: encTitle, content: encContent, dateDue: dateDue })
            }).then(function (r) { return r.json(); }).then(function (data) {
                if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) data.todo.title = title;
                document.getElementById('todo-list').appendChild(bakeTodoDOM(data.todo));
                var emptyState = _root.querySelector('#todo-list .todo-empty-state');
                if (emptyState) emptyState.style.display = 'none';
                updateSummaryBar();
                showToast('To-do added.');
            }).catch(function () { showToast('Failed to add to-do.', 'danger'); });
            hideModal('addTodoOverlay');
        }

        async function addEventFromModal() {
            var title = document.querySelector('#addEventOverlay input[type="text"]').value;
            var date = document.querySelector('#addEventOverlay input[type="date"]').value;
            var time = document.querySelector('#addEventOverlay input[type="time"]').value;
            var content = document.querySelector('#addEventOverlay textarea').value;
            if (!title || title.trim().length < 2) { showToast('Please enter a valid event title.', 'warning'); return; }
            var dateOfEvent = date;
            if (date && time) dateOfEvent = date + 'T' + time;
            var encTitle = title, encContent = content;
            if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
                encTitle = await FlaskyE2EE.encryptField(title);
                encContent = await FlaskyE2EE.encryptField(content);
            }
            fetch('/api/add_event', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: encTitle, content: encContent, dateOfEvent: dateOfEvent })
            }).then(function (r) { return r.json(); }).then(function (data) {
                if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) data.event.title = title;
                document.getElementById('event-list').appendChild(bakeEventDOM(data.event));
                var emptyState = _root.querySelector('#event-list .event-empty-state');
                if (emptyState) emptyState.style.display = 'none';
                updateSummaryBar();
                showToast('Event added.');
            }).catch(function () { showToast('Failed to add event.', 'danger'); });
            hideModal('addEventOverlay');
        }

        // ============ Quick add ============
        async function quickAddTodo() {
            var input = document.getElementById('new-todo');
            var title = input.value;
            if (!title || title.trim() === '' || title.length < 2) { showToast('Please enter a valid to-do item.', 'warning'); return; }
            var encTitle = title, encContent = '';
            if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
                encTitle = await FlaskyE2EE.encryptField(title);
                encContent = await FlaskyE2EE.encryptField('');
            }
            fetch('/api/add_todo', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: encTitle, content: encContent, dateDue: '' })
            }).then(function (r) { return r.json(); }).then(function (data) {
                if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) data.todo.title = title;
                document.getElementById('todo-list').appendChild(bakeTodoDOM(data.todo));
                input.value = '';
                var emptyState = _root.querySelector('#todo-list .todo-empty-state');
                if (emptyState) emptyState.style.display = 'none';
                updateSummaryBar();
            }).catch(function () { showToast('Failed to add to-do.', 'danger'); });
        }

        async function quickAddEvent() {
            var input = document.getElementById('new-event');
            var title = input.value;
            if (!title || title.trim() === '' || title.length < 2) { showToast('Please enter a valid event.', 'warning'); return; }
            var encTitle = title, encContent = '';
            if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
                encTitle = await FlaskyE2EE.encryptField(title);
                encContent = await FlaskyE2EE.encryptField('');
            }
            fetch('/api/add_event', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: encTitle, content: encContent, dateOfEvent: '' })
            }).then(function (r) { return r.json(); }).then(function (data) {
                if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) data.event.title = title;
                document.getElementById('event-list').appendChild(bakeEventDOM(data.event));
                input.value = '';
                var emptyState = _root.querySelector('#event-list .event-empty-state');
                if (emptyState) emptyState.style.display = 'none';
                updateSummaryBar();
            }).catch(function () { showToast('Failed to add event.', 'danger'); });
        }

        // ============ Save notes ============
        function saveNotes(isAutosave) {
            if (!isAutosave) {
                document.getElementById('save-notes-btn').disabled = true;
                document.getElementById('save-notes-btn').innerText = 'Saving...';
            }
            fetch('/api/save_agenda_notes', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: document.getElementById('agenda-notes').value })
            }).then(function (r) { return r.json(); }).then(function () {
                lastSavedContent = document.getElementById('agenda-notes').value;
                if (isAutosave) {
                    document.getElementById('autosave-status').innerText = 'Saved';
                    setTimeout(function () { var el = document.getElementById('autosave-status'); if (el) el.innerText = ''; }, 2000);
                } else {
                    document.getElementById('save-notes-btn').innerText = 'Saved!';
                    document.getElementById('autosave-status').innerText = '';
                    setTimeout(function () {
                        var btn = document.getElementById('save-notes-btn');
                        if (btn) { btn.disabled = false; btn.innerText = 'Save Notes'; }
                    }, 2500);
                }
            }).catch(function () {
                if (!isAutosave) {
                    var btn = document.getElementById('save-notes-btn');
                    if (btn) { btn.disabled = false; btn.innerText = 'Save Notes'; }
                }
                showToast('Failed to save notes.', 'danger');
            });
        }

        // ============ Summary bar ============
        function updateSummaryBar() {
            if (!_root) return;
            var overdue = 0, today = 0, pending = 0, events = 0, done = 0;
            _root.querySelectorAll('#todo-list .todo-item').forEach(function (item) {
                if (item.dataset.completed === 'true') { done++; return; }
                pending++;
                var label = item.querySelector('.todo-label');
                if (!label) return;
                var badge = label.querySelector('.badge');
                if (!badge) return;
                if (badge.classList.contains('badge-secondary')) overdue++;
                else if (badge.classList.contains('badge-info')) today++;
            });
            events = _root.querySelectorAll('#event-list .event-item').length;
            var el;
            el = _root.querySelector('#summaryOverdue .summary-count'); if (el) el.textContent = overdue;
            el = _root.querySelector('#summaryToday .summary-count'); if (el) el.textContent = today;
            el = _root.querySelector('#summaryPending .summary-count'); if (el) el.textContent = pending;
            el = _root.querySelector('#summaryEvents .summary-count'); if (el) el.textContent = events;
            el = _root.querySelector('#summaryDone .summary-count'); if (el) el.textContent = done;
        }

        // ============ Event delegation ============
        bind(_root, 'click', function (e) {
            var el = e.target.closest('[data-action]');
            if (!el) return;
            var action = el.dataset.action;
            switch (action) {
                case 'router-back': history.back(); break;
                case 'toggle-sidebar': toggleSidebar(); break;
                case 'toggle-theme': toggleTheme(); break;
                case 'open-search-modal': e.preventDefault(); if (window.FlaskySearchModal) FlaskySearchModal.open(); break;
                case 'show-archived-todos': e.preventDefault(); showArchivedTodosModal(); break;
                case 'show-past-events': e.preventDefault(); showPastEventsModal(); break;
                case 'filter-todos': filterTodos(el.dataset.filter); break;
                case 'show-add-todo-modal': showAddTodoModal(); break;
                case 'show-add-event-modal': showAddEventModal(); break;
                case 'show-todo-details': showTodoDetailsModal(parseInt(el.dataset.id, 10)); break;
                case 'show-event-details': showEventDetailsModal(parseInt(el.dataset.id, 10)); break;
                case 'archive-todo': archiveTodo(e); break;
                case 'confirm-delete-todo': confirmDeleteTodo(e); break;
                case 'confirm-delete-event': confirmDeleteEvent(e); break;
                case 'quick-add-todo': quickAddTodo(); break;
                case 'quick-add-event': quickAddEvent(); break;
                case 'save-notes': saveNotes(); break;
                case 'hide-modal': hideModal(el.dataset.modal); break;
                case 'add-todo-from-modal': addTodoFromModal(); break;
                case 'add-event-from-modal': addEventFromModal(); break;
                case 'save-todo-from-modal': saveTodoFromModal(); break;
                case 'save-event-from-modal': saveEventFromModal(); break;
                case 'unarchive-todo': unarchiveTodo(parseInt(el.dataset.id, 10)); break;
                case 'delete-archived-todo': deleteTodoFromEvent(e); break;
                case 'delete-past-event': deletePastEvent(e); break;
                case 'dismiss-toast': el.closest('.toast').remove(); break;
                case 'toggle-ai-panel': toggleAIPanel(); break;
                case 'close-ai-panel': closeAIPanel(); break;
                case 'new-ai-chat': newAIChat(); break;
                case 'toggle-ai-context': toggleAgendaContext(); break;
                case 'remove-ai-context': if (aiAgendaContext) toggleAgendaContext(); break;
                case 'send-ai-message': aiSendMessage(); break;
                case 'stop-ai-stream': if (_aiAbortController) _aiAbortController.abort(); break;
                case 'smart-add-todo': smartAddTodo(); break;
            }
        });

        bind(_root, 'change', function (e) {
            if (e.target.classList.contains('todo-checkbox')) toggleTodoItem(e);
        });

        bind(document.getElementById('new-todo'), 'keydown', function (e) { if (e.key === 'Enter') quickAddTodo(); });
        bind(document.getElementById('new-event'), 'keydown', function (e) { if (e.key === 'Enter') quickAddEvent(); });
        bind(document.getElementById('agenda-notes'), 'keydown', function (e) {
            if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveNotes(); }
        });
        bindDoc(document, 'keydown', function (e) {
            if (e.ctrlKey && e.key === 'k') { e.preventDefault(); if (window.FlaskySearchModal) FlaskySearchModal.open(); }
        });

        // Initial summary after E2EE decryption or page load
        (function () {
            var origDecrypted = _root.classList.contains('e2ee-decrypted');
            if (!origDecrypted && typeof FlaskyE2EE !== 'undefined') {
                _summaryObserver = new MutationObserver(function () {
                    if (_root.classList.contains('e2ee-decrypted')) {
                        if (_summaryObserver) _summaryObserver.disconnect();
                        _summaryObserver = null;
                        updateSummaryBar();
                    }
                });
                _summaryObserver.observe(_root, { attributes: true, attributeFilter: ['class'] });
                _summaryTimer = setTimeout(function () { _summaryTimer = null; if (_summaryObserver) { _summaryObserver.disconnect(); _summaryObserver = null; } updateSummaryBar(); }, 3000);
            } else {
                updateSummaryBar();
            }
        })();

        // ============ AI Panel (only if present) ============
        var aiPanelEl = document.getElementById('aiPanel');

        if (aiPanelEl) {
            if (typeof marked !== 'undefined' && typeof marked.setOptions === 'function') marked.setOptions({ breaks: true, gfm: true });

            (function () {
                var select = document.getElementById('aiModelSelect');
                if (!select) return;
                var currentModel = select.value;
                fetch('/ai/api/models').then(function (r) { return r.json(); }).then(function (data) {
                    var models = data.models || [];
                    if (models.length === 0) return;
                    select.innerHTML = '';
                    models.forEach(function (m) {
                        var opt = document.createElement('option');
                        opt.value = m; opt.textContent = m;
                        if (m === currentModel) opt.selected = true;
                        select.appendChild(opt);
                    });
                }).catch(function () {});
            })();

            var aiModelSelect = document.getElementById('aiModelSelect');
            if (aiModelSelect) {
                bind(aiModelSelect, 'change', function () {
                    fetch('/ai/api/settings', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ model: aiModelSelect.value })
                    }).catch(function () { showToast('Failed to save model selection.', 'danger'); });
                });
            }
        }

        function aiRenderMarkdown(text) {
                var html = typeof marked !== 'undefined' ? marked(text) : escapeHtml(text).replace(/\n/g, '<br>');
                return typeof sanitizeMarkdown === 'function' ? sanitizeMarkdown(html) : html;
            }

            function aiAddMessage(role, content, isHtml) {
                var c = document.getElementById('aiPanelMessages');
                if (!c) return null;
                var msgDiv = document.createElement('div');
                msgDiv.className = 'ai-msg ai-msg-' + role;
                var contentDiv = document.createElement('div');
                contentDiv.className = 'ai-msg-content';
                if (isHtml) contentDiv.innerHTML = content; else contentDiv.textContent = content;
                msgDiv.appendChild(contentDiv);
                c.appendChild(msgDiv);
                c.scrollTop = c.scrollHeight;
                return contentDiv;
            }

            function toggleAIPanel(forceOpen) {
                var panel = document.getElementById('aiPanel');
                if (!panel) return;
                if (forceOpen) panel.classList.remove('collapsed'); else panel.classList.toggle('collapsed');
                var btn = _root.querySelector('[data-action="toggle-ai-panel"]');
                if (btn) btn.classList.toggle('active', !panel.classList.contains('collapsed'));
                if (!panel.classList.contains('collapsed')) {
                    var inp = document.getElementById('aiPanelInput');
                    if (inp) inp.focus();
                }
            }

            function closeAIPanel() {
                var panel = document.getElementById('aiPanel');
                if (panel) panel.classList.add('collapsed');
                var btn = _root.querySelector('[data-action="toggle-ai-panel"]');
                if (btn) btn.classList.remove('active');
            }

            function newAIChat() {
                aiConversationId = null; aiLocalMessages = []; aiAgendaContext = null; aiStreamCallback = null;
                var c = document.getElementById('aiPanelMessages'); if (c) c.innerHTML = '';
                var ctx = document.getElementById('aiPanelContext'); if (ctx) ctx.style.display = 'none';
                var ctxBtn = _root.querySelector('[data-action="toggle-ai-context"]'); if (ctxBtn) ctxBtn.classList.remove('active');
                var sug = document.getElementById('aiPanelSuggestions'); if (sug) sug.style.display = '';
                var st = document.getElementById('aiPanelStatus'); if (st) st.textContent = 'Ready';
                var inp = document.getElementById('aiPanelInput'); if (inp) inp.focus();
            }

            function toggleAgendaContext() {
                var contextEl = document.getElementById('aiPanelContext');
                var contextBtn = _root.querySelector('[data-action="toggle-ai-context"]');
                if (aiAgendaContext) {
                    aiAgendaContext = null;
                    if (contextEl) contextEl.style.display = 'none';
                    if (contextBtn) contextBtn.classList.remove('active');
                    return;
                }
                if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted() && !FlaskyE2EE.isReady()) {
                    showToast('Unlock encryption first to include context.', 'warning'); return;
                }
                var lines = []; var MAX = 2000;
                var today = new Date(); var dateStr = today.toISOString().split('T')[0];
                lines.push('Today is ' + dateStr + ' (' + today.toLocaleDateString(undefined, { weekday: 'long' }) + ').');
                lines.push('');
                _root.querySelectorAll('#todo-list .todo-item').forEach(function (item) {
                    if (item.dataset.completed === 'true') return;
                    if (item.style.display === 'none') return;
                    var label = item.querySelector('.todo-label');
                    if (label) {
                        var text = label.childNodes[0] ? label.childNodes[0].textContent.trim() : '';
                        var badge = label.querySelector('.badge');
                        if (badge) text += ' (' + badge.textContent.trim() + ')';
                        if (item.dataset.date) text += ' [due: ' + new Date(item.dataset.date).toLocaleDateString() + ']';
                        lines.push('- [ ] ' + text);
                    }
                });
                _root.querySelectorAll('#event-list .event-item').forEach(function (item) {
                    if (item.style.display === 'none') return;
                    var label = item.querySelector('.event-label');
                    if (label) {
                        var text = label.childNodes[0] ? label.childNodes[0].textContent.trim() : '';
                        var badge = label.querySelector('.badge');
                        if (badge) text += ' (' + badge.textContent.trim() + ')';
                        if (item.dataset.date) text += ' [date: ' + new Date(item.dataset.date).toLocaleDateString() + ']';
                        lines.push('- ' + text);
                    }
                });
                var notesArea = document.getElementById('agenda-notes');
                if (notesArea && notesArea.value.trim()) lines.push('\nAgenda Notes:\n' + notesArea.value.trim());
                var context = lines.join('\n');
                if (context.length > MAX) context = context.substring(0, MAX) + '\n... (truncated)';
                if (!context.trim()) { showToast('No agenda items to include as context.', 'warning'); return; }
                aiAgendaContext = context;
                if (contextEl) contextEl.style.display = 'flex';
                if (contextBtn) contextBtn.classList.add('active');
            }

            async function aiSendMessage() {
                var input = document.getElementById('aiPanelInput');
                if (!input) return;
                var text = input.value.trim();
                if (!text || aiIsStreaming) return;
                input.value = ''; input.style.height = 'auto'; input.style.height = input.scrollHeight + 'px';
                var sug = document.getElementById('aiPanelSuggestions'); if (sug) sug.style.display = 'none';
                aiAddMessage('user', text, false);
                var messageForModel = text;
                if (aiAgendaContext) messageForModel = 'The user has shared their current agenda:\n---\n' + aiAgendaContext + '\n---\n\n' + text;
                var encryptedMessage = messageForModel;
                if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) encryptedMessage = await FlaskyE2EE.encryptField(messageForModel);
                aiLocalMessages.push({ role: 'user', content: messageForModel });
                var st = document.getElementById('aiPanelStatus'); if (st) st.innerHTML = '<span class="streaming">Sending...</span>';
                if (!aiConversationId) {
                    var title = text.substring(0, 100);
                    if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) title = await FlaskyE2EE.encryptField(title);
                    try {
                        var resp = await fetch('/ai/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title }) });
                        var data = await resp.json();
                        if (data.error) { aiAddMessage('system', data.error, false); if (st) st.textContent = 'Ready'; return; }
                        aiConversationId = data.id;
                    } catch (e) { aiAddMessage('system', 'Failed to create conversation.', false); if (st) st.textContent = 'Ready'; return; }
                }
                aiStreamResponse(encryptedMessage);
            }

            function aiStreamResponse(encryptedMessage, silent) { aiStreamResponseWith(encryptedMessage, aiLocalMessages, aiConversationId, silent); }

            function aiStreamResponseWith(encryptedMessage, messagesArr, convId, silent) {
                aiIsStreaming = true;
                var sendBtn = _root.querySelector('[data-action="send-ai-message"]');
                var stopBtn = _root.querySelector('[data-action="stop-ai-stream"]');
                var input = document.getElementById('aiPanelInput');
                if (sendBtn) sendBtn.style.display = 'none';
                if (stopBtn) stopBtn.style.display = 'inline-flex';
                if (input) input.disabled = true;
                var st = document.getElementById('aiPanelStatus'); if (st) st.innerHTML = '<span class="streaming">Thinking...</span>';
                var assistantDiv = null;
                if (!silent) { assistantDiv = aiAddMessage('assistant', '', false); if (assistantDiv) assistantDiv.classList.add('ai-cursor-blink'); }
                _aiAbortController = new AbortController();
                var chatBody = { message: encryptedMessage };
                if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) chatBody.messages = messagesArr;
                fetch('/ai/api/conversations/' + convId + '/chat', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(chatBody), signal: _aiAbortController.signal
                }).then(function (response) {
                    if (!response.ok) { aiFinishStream(assistantDiv, 'Error: ' + response.status, null, false, silent); return; }
                    var reader = response.body.getReader();
                    var decoder = new TextDecoder();
                    var fullText = ''; var streamFinished = false;
                    function read() {
                        reader.read().then(function (result) {
                            if (result.done) { if (!streamFinished) aiFinishStream(assistantDiv, fullText, null, false, silent); return; }
                            var chunk = decoder.decode(result.value, { stream: true });
                            chunk.split('\n').forEach(function (line) {
                                if (line.startsWith('data: ')) {
                                    try {
                                        var data = JSON.parse(line.substring(6));
                                        if (data.chunk) {
                                            fullText += data.chunk;
                                            if (assistantDiv) assistantDiv.textContent = fullText;
                                            var mc = document.getElementById('aiPanelMessages'); if (mc) mc.scrollTop = mc.scrollHeight;
                                            if (st) st.innerHTML = '<span class="streaming">Streaming...</span>';
                                        } else if (data.error) {
                                            streamFinished = true;
                                            if (assistantDiv) assistantDiv.textContent = data.error;
                                            aiFinishStream(assistantDiv, data.error, null, false, silent);
                                        } else if (data.done) {
                                            streamFinished = true;
                                            aiFinishStream(assistantDiv, fullText, data.message_id, true, silent);
                                        }
                                    } catch (e) {}
                                }
                            });
                            read();
                        }).catch(function (err) {
                            if (err.name === 'AbortError' && !streamFinished) {
                                streamFinished = true; reader.cancel();
                                aiFinishStream(assistantDiv, fullText, null, false, silent);
                            }
                        });
                    }
                    read();
                }).catch(function (err) {
                    if (err.name !== 'AbortError') aiFinishStream(assistantDiv, 'Network error: ' + err.message, null, false, silent);
                });
            }

            function aiFinishStream(div, text, messageId, wasClean, silent) {
                if (div && !silent) {
                    div.classList.remove('ai-cursor-blink');
                    if (text) {
                        div.innerHTML = aiRenderMarkdown(text);
                        aiLocalMessages.push({ role: 'assistant', content: text });
                        if (messageId) {
                            var wrapper = div.closest('.ai-msg');
                            if (wrapper) {
                                wrapper.dataset.messageId = messageId;
                                var actionsDiv = document.createElement('div');
                                actionsDiv.className = 'ai-msg-actions';
                                actionsDiv.innerHTML = '<button class="ai-action-btn" data-action="ai-copy-msg" title="Copy">Copy</button><button class="ai-action-btn" data-action="ai-create-note" title="Create note">Create note</button>';
                                div.parentElement.appendChild(actionsDiv);
                            }
                            if (typeof hljs !== 'undefined') {
                                div.querySelectorAll('pre code').forEach(function (block) { try { hljs.highlightElement(block); } catch (e) {} });
                            }
                        }
                    }
                }
                aiIsStreaming = false;
                var sendBtn = _root.querySelector('[data-action="send-ai-message"]');
                var stopBtn = _root.querySelector('[data-action="stop-ai-stream"]');
                var input = document.getElementById('aiPanelInput');
                if (sendBtn) sendBtn.style.display = 'inline-flex';
                if (stopBtn) stopBtn.style.display = 'none';
                if (input) input.disabled = false;
                var st = document.getElementById('aiPanelStatus'); if (st) st.textContent = wasClean ? 'Ready' : 'Stopped';
                _aiAbortController = null;
                if (input && !silent) input.focus();
                if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted() && messageId && text) {
                    FlaskyE2EE.encryptField(text).then(function (enc) {
                        fetch('/ai/api/messages/' + messageId + '/encrypt', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: enc }) }).catch(function () {});
                    });
                }
                if (aiStreamCallback && text && wasClean) {
                    var cb = aiStreamCallback; aiStreamCallback = null;
                    try { cb(text); } catch (e) { console.error('AI stream callback error:', e); }
                }
            }

            bind(document.getElementById('aiPanelMessages'), 'click', function (e) {
                var actionBtn = e.target.closest('.ai-action-btn');
                if (!actionBtn) return;
                var action = actionBtn.dataset.action;
                var msgEl = actionBtn.closest('.ai-msg');
                var contentEl = msgEl ? msgEl.querySelector('.ai-msg-content') : null;
                if (action === 'ai-copy-msg' && contentEl) {
                    navigator.clipboard.writeText(contentEl.textContent).then(function () { showToast('Copied to clipboard'); });
                }
                if (action === 'ai-create-note' && msgEl && contentEl) {
                    var text = contentEl.textContent;
                    var title = text.substring(0, 100).split('\n')[0] || 'AI Chat Note';
                    fetch('/ai/api/create_note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'custom', title: title, content: text }) })
                        .then(function (r) { return r.json(); }).then(function (data) { if (data.success) showToast('Note created: ' + data.title); else showToast('Failed to create note.', 'warning'); })
                        .catch(function () { showToast('Failed to create note.', 'warning'); });
                }
            });

            bind(document.getElementById('aiPanelSuggestions'), 'click', function (e) {
                var btn = e.target.closest('.ai-suggestion-btn');
                if (!btn || !btn.dataset.prompt) return;
                var inp = document.getElementById('aiPanelInput');
                if (inp) { inp.value = btn.dataset.prompt; inp.focus(); inp.dispatchEvent(new Event('input')); }
            });

            var aiPanelInputEl = document.getElementById('aiPanelInput');
            if (aiPanelInputEl) {
                bind(aiPanelInputEl, 'keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiSendMessage(); } });
                bind(aiPanelInputEl, 'input', function () { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 120) + 'px'; });
            }

            // ============ AI Slash Commands ============
            var agendaNotesEl = document.getElementById('agenda-notes');
            if (agendaNotesEl) {
                bind(agendaNotesEl, 'input', function (e) {
                    var val = e.target.value; var pos = e.target.selectionStart; var before = val.substring(0, pos);
                    if (before.match(/\/ai$/)) showAISlashDropdown(e.target); else hideAISlashDropdown();
                });
            }

            function showAISlashDropdown(textarea) {
                if (!_aiSlashDropdown) {
                    _aiSlashDropdown = document.createElement('div');
                    _aiSlashDropdown.className = 'ai-slash-dropdown';
                    var commands = [
                        { cmd: 'summarize', label: 'Summarize agenda' },
                        { cmd: 'prioritize', label: 'Prioritize to-dos' },
                        { cmd: 'focus', label: 'Daily focus' },
                        { cmd: 'weekly', label: 'Weekly review' }
                    ];
                    commands.forEach(function (c) {
                        var item = document.createElement('div');
                        item.className = 'ai-slash-item'; item.dataset.cmd = c.cmd; item.textContent = c.label;
                        item.addEventListener('click', function () { selectAISlashCommand(c.cmd, c.label); });
                        _aiSlashDropdown.appendChild(item);
                    });
                    document.body.appendChild(_aiSlashDropdown);
                }
                var rect = textarea.getBoundingClientRect();
                _aiSlashDropdown.style.top = (rect.top - _aiSlashDropdown.offsetHeight - 8) + 'px';
                _aiSlashDropdown.style.left = rect.left + 'px';
                _aiSlashDropdown.style.display = 'block';
            }
            function hideAISlashDropdown() { if (_aiSlashDropdown) _aiSlashDropdown.style.display = 'none'; }
            function selectAISlashCommand(cmd, label) {
                var textarea = document.getElementById('agenda-notes');
                if (textarea) textarea.value = textarea.value.replace('/ai', '');
                hideAISlashDropdown();
                var prompts = {
                    summarize: 'Summarize my agenda for today',
                    prioritize: 'Help me prioritize my to-dos based on urgency and importance',
                    focus: 'What should I focus on today given my agenda?',
                    weekly: 'Give me a weekly review based on my completed and pending to-dos'
                };
                toggleAIPanel(true);
                var inp = document.getElementById('aiPanelInput');
                if (inp) { inp.value = prompts[cmd] || label; inp.focus(); inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 120) + 'px'; }
            }

            bindDoc(document, 'click', function (e) {
                if (_aiSlashDropdown && _aiSlashDropdown.style.display !== 'none' && !_aiSlashDropdown.contains(e.target)) hideAISlashDropdown();
            });
            bindDoc(document, 'keydown', function (e) {
                if (e.key === 'Escape' && _aiSlashDropdown && _aiSlashDropdown.style.display !== 'none') hideAISlashDropdown();
            });

            // ============ Smart Todo Creation ============
            async function smartAddTodo() {
                var input = document.getElementById('new-todo');
                var text = input ? input.value.trim() : '';
                if (!text) { showToast('Type a to-do first, then click smart add.', 'warning'); return; }
                input.value = '';
                var today = new Date(); var dateStr = today.toISOString().split('T')[0];
                var prompt = 'You are a to-do parser. Today is ' + dateStr + '. Parse the user input into a to-do item. Return ONLY a JSON object with "title" (string) and "dateDue" (ISO date string YYYY-MM-DD or null if no date mentioned). Do not explain. Do not think out loud. Output only the JSON.\n\nInput: "' + text + '"';
                toggleAIPanel(true);
                var st = document.getElementById('aiPanelStatus'); if (st) st.innerHTML = '<span class="streaming">Parsing to-do...</span>';
                var messageForModel = prompt;
                var encryptedMessage = messageForModel;
                if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) encryptedMessage = await FlaskyE2EE.encryptField(messageForModel);
                var smartConvId = aiConversationId;
                var smartMessages = [{ role: 'user', content: messageForModel }];
                if (!smartConvId) {
                    var title = text.substring(0, 100); var encTitle = title;
                    if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) encTitle = await FlaskyE2EE.encryptField(title);
                    try {
                        var resp = await fetch('/ai/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: encTitle }) });
                        var data = await resp.json();
                        if (data.error) { if (st) st.textContent = 'Ready'; showToast(data.error, 'danger'); return; }
                        smartConvId = data.id; aiConversationId = smartConvId;
                    } catch (e) { if (st) st.textContent = 'Ready'; showToast('Failed to create conversation.', 'danger'); return; }
                }
                aiStreamCallback = function (responseText) {
                    var jsonStr = responseText.trim();
                    jsonStr = jsonStr.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
                    var match = jsonStr.match(/\{[\s\S]*\}/);
                    if (match) jsonStr = match[0];
                    try {
                        var parsed = JSON.parse(jsonStr);
                        if (parsed.title) {
                            var todoTitle = String(parsed.title);
                            var todoDate = parsed.dateDue ? String(parsed.dateDue).split('T')[0] : '';
                            var et = todoTitle, ec = '';
                            (async function () {
                                if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) {
                                    et = await FlaskyE2EE.encryptField(todoTitle);
                                    ec = await FlaskyE2EE.encryptField('');
                                }
                                fetch('/api/add_todo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: et, content: ec, dateDue: todoDate }) })
                                    .then(function (r) { return r.json(); }).then(function (data) {
                                        if (typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted()) data.todo.title = todoTitle;
                                        document.getElementById('todo-list').appendChild(bakeTodoDOM(data.todo));
                                        var es = _root.querySelector('#todo-list .todo-empty-state'); if (es) es.style.display = 'none';
                                        updateSummaryBar();
                                        showToast('To-do created: ' + todoTitle);
                                    }).catch(function () { showToast('Failed to create to-do from AI response.', 'danger'); });
                            })();
                        } else { showToast('AI response did not include a title.', 'warning'); }
                    } catch (e2) { showToast('Could not parse AI response as JSON.', 'warning'); }
                };
                aiStreamResponseWith(encryptedMessage, smartMessages, smartConvId, true);
            }
    }

    function destroy() {
        if (_aiAbortController) { try { _aiAbortController.abort(); } catch (e) {} _aiAbortController = null; }
        if (_autosaveTimer) { clearTimeout(_autosaveTimer); _autosaveTimer = null; }
        if (_summaryTimer) { clearTimeout(_summaryTimer); _summaryTimer = null; }
        if (_summaryObserver) { _summaryObserver.disconnect(); _summaryObserver = null; }
        if (_aiSlashDropdown && _aiSlashDropdown.parentNode) _aiSlashDropdown.parentNode.removeChild(_aiSlashDropdown);
        _aiSlashDropdown = null;
        unbindAll();
        _root = null;
    }

    window.FlaskyViews = window.FlaskyViews || {};
    window.FlaskyViews.agenda = { init: init, destroy: destroy };
})();