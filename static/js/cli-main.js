/* CLI Theme — Main Module
 *
 * Depends on: cli-vim.js (window.CliVim)
 * Call CliMain.init(username) after DOM is ready.
 */
(function() {
    'use strict';

    // --- DOM refs ---
    let commandInput, logInner, locationEl, editOverlay, editHeader,
        editTitle, editContent;

    // --- State ---
    let notes = [];
    let categories = [];
    let currentCategory = null;
    let commandHistory = [];
    let historyIndex = -1;
    let editingNoteId = null;
    let editingTodoId = null;
    let editingEventId = null;
    let pendingConfirm = null;
    let username = '';

    // --- Output helpers ---

    function print(text, colorClass) {
        const el = document.createElement('span');
        el.classList.add('log-entry');
        if (colorClass) el.classList.add(colorClass);
        el.textContent = text;
        logInner.appendChild(el);
        scrollToBottom();
    }

    function printEcho(cmd) {
        print('$ ' + cmd, 'echo-line');
    }

    function printBlank() {
        print('');
    }

    function scrollToBottom() {
        window.scrollTo(0, document.body.scrollHeight);
    }

    function updatePrompt() {
        if (currentCategory) {
            locationEl.textContent = 'flasky/' + username + '/' + currentCategory + ' $';
        } else {
            locationEl.textContent = 'flasky/' + username + ' $';
        }
    }

    // --- E2EE helper ---

    function isEncrypted() {
        return typeof FlaskyE2EE !== 'undefined' && FlaskyE2EE.isEncrypted();
    }

    // --- API helpers ---

    function apiPost(url, body) {
        return fetch(url, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body)
        }).then(function(r) { return r.json(); });
    }

    // --- Data fetching ---

    async function fetchNotes() {
        const data = await fetch('/api/get_all_notes').then(function(r) { return r.json(); });
        notes = data;
        if (isEncrypted()) {
            for (const n of notes) {
                try { n.title = await FlaskyE2EE.decryptField(n.title); } catch(e) {}
                try { n.content = await FlaskyE2EE.decryptField(n.content); } catch(e) {}
                try { n.category = await FlaskyE2EE.decryptField(n.category); } catch(e) {}
            }
        }
        categories = [...new Set(notes.map(function(n) { return n.category; }).filter(Boolean))];
    }

    // --- Command handling ---

    function handleAction() {
        const raw = commandInput.value.trim();
        if (!raw) return;

        commandHistory.push(raw);
        historyIndex = commandHistory.length;
        commandInput.value = '';

        printEcho(raw);

        if (pendingConfirm) {
            const answer = raw.toLowerCase();
            if (answer === 'y' || answer === 'yes') {
                pendingConfirm();
            } else {
                print('Cancelled.', 'clr-dim');
            }
            pendingConfirm = null;
            printBlank();
            return;
        }

        const parts = raw.split(/\s+/);
        const cmd = parts[0].toLowerCase();
        const args = parts.slice(1);
        const argStr = args.join(' ');

        switch(cmd) {
            case 'clear': case 'cls':
                logInner.innerHTML = '';
                break;
            case 'help':
                showHelp();
                break;
            case 'notes': case 'ls': case 'dir':
                listNotes();
                break;
            case 'cat': case 'read':
                readNote(argStr);
                break;
            case 'new': case 'touch':
                createNote(argStr);
                break;
            case 'edit': case 'nano':
                editNote(argStr);
                break;
            case 'vi': case 'vim':
                vimEditNote(argStr);
                break;
            case 'rm': case 'delete':
                deleteNote(argStr);
                break;
            case 'search': case 'grep': case 'find':
                searchNotes(argStr);
                break;
            case 'categories': case 'dirs':
                listCategories();
                break;
            case 'cd':
                changeCategory(argStr);
                break;
            case 'mv':
                moveNoteCategory(args);
                break;
            case 'mkdir':
                createCategory(argStr);
                break;
            case 'rmdir':
                deleteCategory(argStr);
                break;
            case 'todos': case 'todo':
                handleTodo(args);
                break;
            case 'events': case 'event':
                handleEvent(args);
                break;
            case 'backlinks': case 'bl':
                showBacklinks(argStr);
                break;
            case 'outlinks': case 'ol':
                showOutlinks(argStr);
                break;
            case 'whoami':
                print(username, 'clr-green');
                break;
            case 'settings':
                window.location.href = '/settings';
                break;
            case 'logout':
                window.location.href = '/logout';
                break;
            case 'revert':
                revertNote(argStr);
                break;
            case 'rename':
                renameNote(args);
                break;
            case 'date':
                print(new Date().toLocaleString(), 'clr-cyan');
                break;
            case 'stat': case 'stats':
                showStats();
                break;
            default:
                print("Unknown command: '" + cmd + "'. Type 'help' for available commands.", 'clr-red');
        }
        printBlank();
    }

    // --- Commands ---

    function showHelp() {
        print('Available commands:', 'clr-cyan');
        printBlank();
        print('  Notes', 'clr-yellow');
        print('    notes, ls          List notes (filtered by current category)');
        print('    cat <id>           Read a note');
        print('    new <title>        Create a new note');
        print('    edit <id>          Edit a note (simple editor)');
        print('    vi <id>            Edit a note (vim mode)');
        print('    rm <id>            Delete a note');
        print('    rename <id> <t>    Rename a note');
        print('    revert <id>        Revert note to previous version');
        print('    search <query>     Search notes by title');
        print('    backlinks <id>     Show notes linking to this note');
        print('    outlinks <id>      Show outbound links from this note');
        printBlank();
        print('  Categories', 'clr-yellow');
        print('    categories, dirs   List categories');
        print('    cd <name>          Navigate to category (cd .. to go back)');
        print('    mv <id> <cat>      Move a note to a category');
        print('    mkdir <name>       Create a category');
        print('    rmdir <name>       Delete a category');
        printBlank();
        print('  Todos', 'clr-yellow');
        print('    todos              List active todos');
        print('    todos archived     List archived todos');
        print('    todo add <title>   Add a todo (append |YYYY-MM-DD for due date)');
        print('    todo edit <id>     Edit a todo (opens editor)');
        print('    todo done <id>     Toggle todo completion');
        print('    todo archive <id>  Archive a todo');
        print('    todo rm <id>       Delete a todo');
        print('    todo read <id>     View todo details');
        printBlank();
        print('  Events', 'clr-yellow');
        print('    events             List events');
        print('    event add <title>  Add event (append |YYYY-MM-DD for date)');
        print('    event edit <id>    Edit an event (opens editor)');
        print('    event read <id>    View event details');
        print('    event rm <id>      Delete an event');
        printBlank();
        print('  General', 'clr-yellow');
        print('    whoami             Show current user');
        print('    date               Show current date and time');
        print('    stat               Show note/todo/event counts');
        print('    settings           Go to settings page');
        print('    logout             Log out');
        print('    clear, cls         Clear terminal');
        print('    help               Show this help');
    }

    function listNotes() {
        let filtered = notes;
        if (currentCategory) {
            filtered = notes.filter(function(n) { return n.category && n.category.toLowerCase() === currentCategory.toLowerCase(); });
        }
        if (filtered.length === 0) {
            print(currentCategory ? "No notes in '" + currentCategory + "'." : 'No notes found.', 'clr-dim');
            return;
        }
        print('  ID    Title                              Category', 'clr-cyan');
        print('  ----  ---------------------------------  ----------');
        filtered.forEach(function(nt) {
            const id = String(nt.id).padEnd(6);
            const title = (nt.title || '(untitled)').substring(0, 33).padEnd(35);
            const cat = nt.category || '-';
            print('  ' + id + title + cat);
        });
    }

    function readNote(idStr) {
        const id = parseInt(idStr);
        if (isNaN(id)) { print("Usage: cat <note_id>", 'clr-red'); return; }
        const note = notes.find(function(n) { return n.id === id; });
        if (!note) { print('Note ' + id + ' not found.', 'clr-red'); return; }
        print('--- ' + note.title + ' ---', 'clr-cyan');
        if (note.category) print('Category: ' + note.category, 'clr-dim');
        printBlank();
        print(note.content || '(empty)');
    }

    async function createNote(title) {
        if (!title) { print("Usage: new <title>", 'clr-red'); return; }
        let encTitle = title, encContent = '';
        if (isEncrypted()) {
            encTitle = await FlaskyE2EE.encryptField(title);
            encContent = await FlaskyE2EE.encryptField('');
        }
        apiPost('/api/save_note', { noteId: 0, title: encTitle, content: encContent, category: null })
        .then(function(data) {
            if (data.success) {
                print('Note created (id: ' + data.note.id + "). Use 'edit " + data.note.id + "' to add content.", 'clr-green');
                fetchNotes();
            } else {
                print('Error: ' + data.reason, 'clr-red');
            }
        });
    }

    function editNote(idStr) {
        const id = parseInt(idStr);
        if (isNaN(id)) { print("Usage: edit <note_id>", 'clr-red'); return; }
        const note = notes.find(function(n) { return n.id === id; });
        if (!note) { print('Note ' + id + ' not found.', 'clr-red'); return; }

        editingNoteId = id;
        editHeader.textContent = 'Editing note #' + id;
        editTitle.value = note.title || '';
        editContent.value = note.content || '';
        editOverlay.classList.add('active');
        editTitle.focus();
    }

    async function saveEdit() {
        let encTitle = editTitle.value, encContent = editContent.value;
        if (isEncrypted()) {
            encTitle = await FlaskyE2EE.encryptField(editTitle.value);
            encContent = await FlaskyE2EE.encryptField(editContent.value);
        }

        if (editingNoteId !== null) {
            const note = notes.find(function(n) { return n.id === editingNoteId; });
            apiPost('/api/save_note', {
                noteId: editingNoteId,
                title: encTitle,
                content: encContent,
                category: note ? (note.category_id || note.category) : null
            }).then(function(data) {
                closeEdit();
                if (data.success) {
                    print('Note #' + editingNoteId + ' saved.', 'clr-green');
                    if (typeof FlaskySearch !== 'undefined') FlaskySearch.invalidate();
                    fetchNotes();
                } else {
                    print('Error: ' + data.reason, 'clr-red');
                }
            });
        } else if (editingTodoId !== null) {
            const id = editingTodoId;
            apiPost('/api/edit_todo', {
                toDoId: id,
                title: encTitle,
                content: encContent,
                dateDue: ''
            }).then(function(data) {
                closeEdit();
                if (data.success) print('Todo #' + id + ' saved.', 'clr-green');
                else print('Error: ' + data.reason, 'clr-red');
            });
        } else if (editingEventId !== null) {
            const id = editingEventId;
            apiPost('/api/edit_event', {
                eventId: id,
                title: encTitle,
                content: encContent,
                dateOfEvent: ''
            }).then(function(data) {
                closeEdit();
                if (data.success) print('Event #' + id + ' saved.', 'clr-green');
                else print('Error: ' + data.reason, 'clr-red');
            });
        }
    }

    function closeEdit() {
        editOverlay.classList.remove('active');
        editingNoteId = null;
        editingTodoId = null;
        editingEventId = null;
        commandInput.focus();
    }

    function deleteNote(idStr) {
        const id = parseInt(idStr);
        if (isNaN(id)) { print("Usage: rm <note_id>", 'clr-red'); return; }
        const note = notes.find(function(n) { return n.id === id; });
        if (!note) { print('Note ' + id + ' not found.', 'clr-red'); return; }
        print('Delete note "' + note.title + '"? (y/n)', 'clr-yellow');
        pendingConfirm = function() {
            apiPost('/api/delete_note', { noteId: id })
            .then(function(data) {
                if (data.success) {
                    print('Note #' + id + ' deleted.', 'clr-green');
                    fetchNotes();
                } else {
                    print('Error: ' + data.reason, 'clr-red');
                }
            });
        };
    }

    async function searchNotes(query) {
        if (!query) { print("Usage: search <query>", 'clr-red'); return; }
        let results;
        if (isEncrypted()) {
            results = await FlaskySearch.search(query);
        } else {
            results = await apiPost('/api/search_notes', { query: query });
        }
        if (results.length === 0) {
            print("No notes matching '" + query + "'.", 'clr-dim');
            return;
        }
        print('Found ' + results.length + ' note(s):', 'clr-cyan');
        results.forEach(function(nt) {
            print('  ' + String(nt.id).padEnd(6) + (nt.title || '(untitled)').substring(0, 50));
        });
    }

    async function showBacklinks(idStr) {
        if (!idStr) { print("Usage: backlinks <id>", 'clr-red'); return; }
        const id = parseInt(idStr);
        if (isNaN(id)) { print("Invalid note ID.", 'clr-red'); return; }
        if (isEncrypted()) {
            const note = notes.find(function(n) { return n.id === id; });
            if (!note) { print('Note ' + id + ' not found.', 'clr-red'); return; }
            const results = await FlaskySearch.computeBacklinks(note.title);
            if (results.length === 0) { print('No backlinks found.', 'clr-dim'); return; }
            print('Backlinks to note ' + id + ':', 'clr-cyan');
            results.forEach(function(bl) {
                print('  ' + String(bl.id).padEnd(6) + (bl.title || '(untitled)').substring(0, 50));
            });
            return;
        }
        fetch('/api/backlinks/' + id)
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data.backlinks || data.backlinks.length === 0) {
                print('No backlinks found.', 'clr-dim');
                return;
            }
            print('Backlinks to note ' + id + ':', 'clr-cyan');
            data.backlinks.forEach(function(bl) {
                print('  ' + String(bl.id).padEnd(6) + (bl.title || '(untitled)').substring(0, 50));
            });
        })
        .catch(function() { print('Error fetching backlinks.', 'clr-red'); });
    }

    async function showOutlinks(idStr) {
        if (!idStr) { print("Usage: outlinks <id>", 'clr-red'); return; }
        const id = parseInt(idStr);
        if (isNaN(id)) { print("Invalid note ID.", 'clr-red'); return; }
        if (isEncrypted()) {
            const note = notes.find(function(n) { return n.id === id; });
            if (!note) { print('Note ' + id + ' not found.', 'clr-red'); return; }
            const results = await FlaskySearch.computeOutboundLinks(note.content || '');
            if (results.length === 0) { print('No outbound links found.', 'clr-dim'); return; }
            print('Outbound links from note ' + id + ':', 'clr-cyan');
            results.forEach(function(ol) {
                print('  ' + String(ol.id).padEnd(6) + (ol.title || '(untitled)').substring(0, 50));
            });
            return;
        }
        fetch('/api/outbound-links/' + id)
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data.outbound_links || data.outbound_links.length === 0) {
                print('No outbound links found.', 'clr-dim');
                return;
            }
            print('Outbound links from note ' + id + ':', 'clr-cyan');
            data.outbound_links.forEach(function(ol) {
                print('  ' + String(ol.id).padEnd(6) + (ol.title || '(untitled)').substring(0, 50));
            });
        })
        .catch(function() { print('Error fetching outbound links.', 'clr-red'); });
    }

    // --- Revert / Rename / Stats ---

    function revertNote(idStr) {
        const id = parseInt(idStr);
        if (isNaN(id)) { print("Usage: revert <note_id>", 'clr-red'); return; }
        const note = notes.find(function(n) { return n.id === id; });
        if (!note) { print('Note ' + id + ' not found.', 'clr-red'); return; }
        print('Revert note "' + note.title + '" to previous version? (y/n)', 'clr-yellow');
        pendingConfirm = function() {
            apiPost('/api/revert_note', { noteId: id })
            .then(function(data) {
                if (data.success) {
                    print('Note #' + id + ' reverted.', 'clr-green');
                    fetchNotes();
                } else {
                    print('Error: ' + data.reason, 'clr-red');
                }
            });
        };
    }

    async function renameNote(args) {
        if (args.length < 2) { print("Usage: rename <note_id> <new title>", 'clr-red'); return; }
        const id = parseInt(args[0]);
        if (isNaN(id)) { print("First argument must be a note ID.", 'clr-red'); return; }
        const note = notes.find(function(n) { return n.id === id; });
        if (!note) { print('Note ' + id + ' not found.', 'clr-red'); return; }
        const newTitle = args.slice(1).join(' ');
        let encTitle = newTitle, encContent = note.content || '';
        if (isEncrypted()) {
            encTitle = await FlaskyE2EE.encryptField(newTitle);
            encContent = await FlaskyE2EE.encryptField(encContent);
        }
        apiPost('/api/save_note', {
            noteId: id,
            title: encTitle,
            content: encContent,
            category: note.category
        }).then(function(data) {
            if (data.success) {
                print('Note #' + id + ' renamed to "' + newTitle + '".', 'clr-green');
                fetchNotes();
            } else {
                print('Error: ' + data.reason, 'clr-red');
            }
        });
    }

    async function showStats() {
        const [todoData, archivedData, eventData] = await Promise.all([
            fetch('/api/get_todos').then(function(r) { return r.json(); }),
            fetch('/api/get_todos?archived=true').then(function(r) { return r.json(); }),
            fetch('/api/get_events').then(function(r) { return r.json(); })
        ]);
        const completedTodos = todoData.filter(function(t) { return t.completed; }).length;
        print('Stats:', 'clr-cyan');
        print('  Notes:           ' + notes.length);
        print('  Categories:      ' + categories.length);
        print('  Active todos:    ' + todoData.length + ' (' + completedTodos + ' completed)');
        print('  Archived todos:  ' + archivedData.length);
        print('  Events:          ' + eventData.length);
    }

    // --- Categories ---

    function listCategories() {
        if (categories.length === 0) {
            print('No categories found.', 'clr-dim');
            return;
        }
        print('Categories:', 'clr-cyan');
        categories.forEach(function(c) {
            const count = notes.filter(function(n) { return n.category === c; }).length;
            print('  ' + c.padEnd(20) + ' (' + count + ' note' + (count !== 1 ? 's' : '') + ')');
        });
    }

    function changeCategory(name) {
        if (!name || name === '..' || name === '~' || name === '/') {
            currentCategory = null;
            updatePrompt();
            print('Back to root.', 'clr-dim');
            return;
        }
        const match = categories.find(function(c) { return c.toLowerCase() === name.toLowerCase(); });
        if (!match) {
            print("Category '" + name + "' not found. Use 'categories' to list.", 'clr-red');
            return;
        }
        currentCategory = match;
        updatePrompt();
        print("Now in '" + match + "'.", 'clr-green');
    }

    async function moveNoteCategory(args) {
        if (args.length < 2) { print("Usage: mv <note_id> <category_name>", 'clr-red'); return; }
        const id = parseInt(args[0]);
        const catName = args.slice(1).join(' ');
        if (isNaN(id)) { print("First argument must be a note ID.", 'clr-red'); return; }
        let catValue = catName;
        if (isEncrypted()) {
            const treeResp = await fetch('/api/sidebar_tree?note_id=0').then(function(r) { return r.json(); });
            const cats = treeResp.categories || [];
            let found = null;
            for (const c of cats) {
                try {
                    const dec = await FlaskyE2EE.decryptField(c.name);
                    if (dec && dec.toLowerCase() === catName.toLowerCase()) { found = c.id; break; }
                } catch(e) {}
            }
            if (found === null) { print("Category not found: " + catName, 'clr-red'); return; }
            catValue = found;
        }
        apiPost('/api/edit_note_category', { noteId: id, category: catValue })
        .then(function(data) {
            if (data.success) {
                print("Note #" + id + " moved to '" + catName + "'.", 'clr-green');
                fetchNotes();
            } else {
                print('Error: ' + data.reason, 'clr-red');
            }
        });
    }

    function createCategory(name) {
        if (!name) { print("Usage: mkdir <category_name>", 'clr-red'); return; }
        apiPost('/api/add_category', { categoryName: name })
        .then(function(data) {
            if (data.success) {
                print("Category '" + name + "' created.", 'clr-green');
                fetchNotes();
            } else {
                print('Error: ' + data.reason, 'clr-red');
            }
        });
    }

    async function deleteCategory(name) {
        if (!name) { print("Usage: rmdir <category_name>", 'clr-red'); return; }
        const cat = categories.find(function(c) { return c.toLowerCase() === name.toLowerCase(); });
        if (!cat) { print("Category '" + name + "' not found.", 'clr-red'); return; }
        const noteCount = notes.filter(function(n) { return n.category === cat; }).length;
        print('Delete category "' + cat + '"?' + (noteCount > 0 ? ' ' + noteCount + ' note(s) will be moved to Main.' : '') + ' (y/n)', 'clr-yellow');
        pendingConfirm = async function() {
            const treeData = await fetch('/api/sidebar_tree_data').then(function(r) { return r.json(); });
            if (!treeData.success) { print('Error fetching category data.', 'clr-red'); return; }
            let catEntry = treeData.categories.find(function(c) { return c.name.toLowerCase() === cat.toLowerCase(); });
            if (isEncrypted()) {
                for (const c of treeData.categories) {
                    try { c.decrypted = await FlaskyE2EE.decryptField(c.name); } catch(e) { c.decrypted = c.name; }
                }
                catEntry = treeData.categories.find(function(c) { return c.decrypted && c.decrypted.toLowerCase() === cat.toLowerCase(); });
            }
            if (!catEntry) { print("Could not find category ID for '" + cat + "'.", 'clr-red'); return; }
            apiPost('/api/delete_category', { categoryId: catEntry.id })
            .then(function(data) {
                if (data.success) {
                    print("Category '" + cat + "' deleted.", 'clr-green');
                    fetchNotes();
                } else {
                    print('Error: ' + data.reason, 'clr-red');
                }
            });
        };
    }

    // --- Todos ---

    function handleTodo(args) {
        if (args.length === 0 || args[0] === 'list') {
            fetchTodos(false);
            return;
        }
        const sub = args[0].toLowerCase();
        const rest = args.slice(1);

        switch(sub) {
            case 'archived':
                fetchTodos(true);
                break;
            case 'add':
                addTodo(rest.join(' '));
                break;
            case 'done': case 'toggle':
                toggleTodo(rest[0]);
                break;
            case 'archive':
                archiveTodo(rest[0]);
                break;
            case 'unarchive':
                unarchiveTodo(rest[0]);
                break;
            case 'rm': case 'delete':
                deleteTodo(rest[0]);
                break;
            case 'read': case 'cat':
                readTodo(rest[0]);
                break;
            case 'edit': case 'nano':
                editTodo(rest[0]);
                break;
            case 'vi': case 'vim':
                vimEditTodo(rest[0]);
                break;
            default:
                fetchTodos(false);
        }
    }

    async function fetchTodos(archived) {
        const url = archived ? '/api/get_todos?archived=true' : '/api/get_todos';
        const todos = await fetch(url).then(function(r) { return r.json(); });
        if (isEncrypted()) {
            for (const t of todos) {
                try { t.title = await FlaskyE2EE.decryptField(t.title); } catch(e) {}
            }
        }
        if (todos.length === 0) {
            print(archived ? 'No archived todos.' : 'No active todos.', 'clr-dim');
            return;
        }
        print(archived ? 'Archived todos:' : 'Active todos:', 'clr-cyan');
        print('  ID    Status  Due           Title');
        print('  ----  ------  ------------  -------------------------');
        todos.forEach(function(t) {
            const id = String(t.id).padEnd(6);
            const status = t.completed ? '[x]   ' : '[ ]   ';
            const due = (t.time_until_due || '-').substring(0, 12).padEnd(14);
            const title = (t.title || '(untitled)').substring(0, 30);
            print('  ' + id + status + due + title);
        });
    }

    async function addTodo(input) {
        if (!input) { print("Usage: todo add <title> or todo add <title>|<YYYY-MM-DD>", 'clr-red'); return; }
        const parts = input.split('|');
        const title = parts[0].trim();
        const dateDue = parts[1] ? parts[1].trim() : '';
        let encTitle = title, encContent = '';
        if (isEncrypted()) {
            encTitle = await FlaskyE2EE.encryptField(title);
            encContent = await FlaskyE2EE.encryptField('');
        }
        apiPost('/api/add_todo', { title: encTitle, content: encContent, dateDue: dateDue })
        .then(function(data) {
            if (data.success) {
                print('Todo created (id: ' + data.id + ').', 'clr-green');
            } else {
                print('Error: ' + data.reason, 'clr-red');
            }
        });
    }

    function toggleTodo(idStr) {
        const id = parseInt(idStr);
        if (isNaN(id)) { print("Usage: todo done <id>", 'clr-red'); return; }
        fetch('/api/get_todo/' + id).then(function(r) { return r.json(); }).then(function(data) {
            if (!data.success) { print('Todo ' + id + ' not found.', 'clr-red'); return; }
            const newStatus = data.todo.completed ? "0" : "1";
            apiPost('/api/toggle_todo', { toDoId: id, status: newStatus })
            .then(function(res) {
                if (res.success) {
                    print('Todo #' + id + ' ' + (newStatus === "1" ? 'completed' : 'uncompleted') + '.', 'clr-green');
                } else {
                    print('Error: ' + res.reason, 'clr-red');
                }
            });
        });
    }

    function archiveTodo(idStr) {
        const id = parseInt(idStr);
        if (isNaN(id)) { print("Usage: todo archive <id>", 'clr-red'); return; }
        apiPost('/api/archive_todo', { toDoId: id })
        .then(function(data) {
            if (data.success) print('Todo #' + id + ' archived.', 'clr-green');
            else print('Error: ' + data.reason, 'clr-red');
        });
    }

    function unarchiveTodo(idStr) {
        const id = parseInt(idStr);
        if (isNaN(id)) { print("Usage: todo unarchive <id>", 'clr-red'); return; }
        apiPost('/api/unarchive_todo', { toDoId: id })
        .then(function(data) {
            if (data.success) print('Todo #' + id + ' unarchived.', 'clr-green');
            else print('Error: ' + data.reason, 'clr-red');
        });
    }

    function deleteTodo(idStr) {
        const id = parseInt(idStr);
        if (isNaN(id)) { print("Usage: todo rm <id>", 'clr-red'); return; }
        fetch('/api/get_todo/' + id).then(function(r) { return r.json(); }).then(function(data) {
            if (!data.success) { print('Todo ' + id + ' not found.', 'clr-red'); return; }
            print('Delete todo "' + data.todo.title + '"? (y/n)', 'clr-yellow');
            pendingConfirm = function() {
                apiPost('/api/delete_todo', { toDoId: id })
                .then(function(res) {
                    if (res.success) print('Todo #' + id + ' deleted.', 'clr-green');
                    else print('Error: ' + res.reason, 'clr-red');
                });
            };
        });
    }

    async function readTodo(idStr) {
        const id = parseInt(idStr);
        if (isNaN(id)) { print("Usage: todo read <id>", 'clr-red'); return; }
        const data = await fetch('/api/get_todo/' + id).then(function(r) { return r.json(); });
        if (!data.success) { print('Todo ' + id + ' not found.', 'clr-red'); return; }
        const t = data.todo;
        if (isEncrypted()) {
            try { t.title = await FlaskyE2EE.decryptField(t.title); } catch(e) {}
            try { t.content = await FlaskyE2EE.decryptField(t.content); } catch(e) {}
        }
        print('--- ' + t.title + ' ---', 'clr-cyan');
        print('Status: ' + (t.completed ? 'Completed' : 'Pending') + (t.archived ? ' (archived)' : ''), 'clr-dim');
        if (t.time_until_due) print('Due: ' + t.time_until_due, 'clr-dim');
        if (t.content) {
            printBlank();
            print(t.content);
        }
    }

    async function editTodo(idStr) {
        const id = parseInt(idStr);
        if (isNaN(id)) { print("Usage: todo edit <id>", 'clr-red'); return; }
        const data = await fetch('/api/get_todo/' + id).then(function(r) { return r.json(); });
        if (!data.success) { print('Todo ' + id + ' not found.', 'clr-red'); return; }
        const t = data.todo;
        if (isEncrypted()) {
            try { t.title = await FlaskyE2EE.decryptField(t.title); } catch(e) {}
            try { t.content = await FlaskyE2EE.decryptField(t.content); } catch(e) {}
        }
        editingTodoId = id;
        editHeader.textContent = 'Editing todo #' + id;
        editTitle.value = t.title || '';
        editContent.value = t.content || '';
        editOverlay.classList.add('active');
        editTitle.focus();
    }

    // --- Events ---

    function handleEvent(args) {
        if (args.length === 0 || args[0] === 'list') {
            fetchEvents();
            return;
        }
        const sub = args[0].toLowerCase();
        const rest = args.slice(1);

        switch(sub) {
            case 'add':
                addEvent(rest.join(' '));
                break;
            case 'rm': case 'delete':
                deleteEvent(rest[0]);
                break;
            case 'read': case 'cat':
                readEvent(rest[0]);
                break;
            case 'edit': case 'nano':
                editEvent(rest[0]);
                break;
            case 'vi': case 'vim':
                vimEditEvent(rest[0]);
                break;
            default:
                fetchEvents();
        }
    }

    async function fetchEvents() {
        const events = await fetch('/api/get_events').then(function(r) { return r.json(); });
        if (isEncrypted()) {
            for (const ev of events) {
                try { ev.title = await FlaskyE2EE.decryptField(ev.title); } catch(e) {}
            }
        }
        if (events.length === 0) {
            print('No events.', 'clr-dim');
            return;
        }
        print('Events:', 'clr-cyan');
        print('  ID    When              Title');
        print('  ----  ----------------  -------------------------');
        events.forEach(function(ev) {
            const id = String(ev.id).padEnd(6);
            const when = (ev.time_until_event || '-').substring(0, 16).padEnd(18);
            const title = (ev.title || '(untitled)').substring(0, 30);
            print('  ' + id + when + title);
        });
    }

    async function addEvent(input) {
        if (!input) { print("Usage: event add <title> or event add <title>|<YYYY-MM-DD>", 'clr-red'); return; }
        const parts = input.split('|');
        const title = parts[0].trim();
        const dateOfEvent = parts[1] ? parts[1].trim() : '';
        let encTitle = title, encContent = '';
        if (isEncrypted()) {
            encTitle = await FlaskyE2EE.encryptField(title);
            encContent = await FlaskyE2EE.encryptField('');
        }
        apiPost('/api/add_event', { title: encTitle, content: encContent, dateOfEvent: dateOfEvent })
        .then(function(data) {
            if (data.success) {
                print('Event created (id: ' + data.id + ').', 'clr-green');
            } else {
                print('Error: ' + data.reason, 'clr-red');
            }
        });
    }

    function deleteEvent(idStr) {
        const id = parseInt(idStr);
        if (isNaN(id)) { print("Usage: event rm <id>", 'clr-red'); return; }
        fetch('/api/get_event/' + id).then(function(r) { return r.json(); }).then(function(data) {
            if (!data.success) { print('Event ' + id + ' not found.', 'clr-red'); return; }
            print('Delete event "' + data.event.title + '"? (y/n)', 'clr-yellow');
            pendingConfirm = function() {
                apiPost('/api/delete_event', { eventId: id })
                .then(function(res) {
                    if (res.success) print('Event #' + id + ' deleted.', 'clr-green');
                    else print('Error: ' + res.reason, 'clr-red');
                });
            };
        });
    }

    async function readEvent(idStr) {
        const id = parseInt(idStr);
        if (isNaN(id)) { print("Usage: event read <id>", 'clr-red'); return; }
        const data = await fetch('/api/get_event/' + id).then(function(r) { return r.json(); });
        if (!data.success) { print('Event ' + id + ' not found.', 'clr-red'); return; }
        const ev = data.event;
        if (isEncrypted()) {
            try { ev.title = await FlaskyE2EE.decryptField(ev.title); } catch(e) {}
            try { ev.content = await FlaskyE2EE.decryptField(ev.content); } catch(e) {}
        }
        print('--- ' + ev.title + ' ---', 'clr-cyan');
        if (ev.time_until_event) print('When: ' + ev.time_until_event, 'clr-dim');
        if (ev.content) {
            printBlank();
            print(ev.content);
        }
    }

    async function editEvent(idStr) {
        const id = parseInt(idStr);
        if (isNaN(id)) { print("Usage: event edit <id>", 'clr-red'); return; }
        const data = await fetch('/api/get_event/' + id).then(function(r) { return r.json(); });
        if (!data.success) { print('Event ' + id + ' not found.', 'clr-red'); return; }
        const ev = data.event;
        if (isEncrypted()) {
            try { ev.title = await FlaskyE2EE.decryptField(ev.title); } catch(e) {}
            try { ev.content = await FlaskyE2EE.decryptField(ev.content); } catch(e) {}
        }
        editingEventId = id;
        editHeader.textContent = 'Editing event #' + id;
        editTitle.value = ev.title || '';
        editContent.value = ev.content || '';
        editOverlay.classList.add('active');
        editTitle.focus();
    }

    // --- Vim bridge ---

    async function vimOnSave(type, id, title, content) {
        let encTitle = title, encContent = content;
        if (isEncrypted()) {
            encTitle = await FlaskyE2EE.encryptField(title);
            encContent = await FlaskyE2EE.encryptField(content);
        }
        let ok = false;
        if (type === 'note') {
            const note = notes.find(function(n) { return n.id === id; });
            const data = await apiPost('/api/save_note', {
                noteId: id,
                title: encTitle,
                content: encContent,
                category: note ? (note.category_id || note.category) : null
            });
            ok = data.success;
            if (ok) {
                if (typeof FlaskySearch !== 'undefined') FlaskySearch.invalidate();
                await fetchNotes();
            }
        } else if (type === 'todo') {
            const data = await apiPost('/api/edit_todo', {
                toDoId: id,
                title: encTitle,
                content: encContent,
                dateDue: ''
            });
            ok = data.success;
        } else if (type === 'event') {
            const data = await apiPost('/api/edit_event', {
                eventId: id,
                title: encTitle,
                content: encContent,
                dateOfEvent: ''
            });
            ok = data.success;
        }
        return ok;
    }

    function vimOnClose() {
        commandInput.focus();
    }

    function vimEditNote(idStr) {
        const id = parseInt(idStr);
        if (isNaN(id)) { print("Usage: vi <note_id>", 'clr-red'); return; }
        const note = notes.find(function(n) { return n.id === id; });
        if (!note) { print('Note ' + id + ' not found.', 'clr-red'); return; }
        CliVim.open('note', id, note.title || '', note.content || '');
    }

    async function vimEditTodo(idStr) {
        const id = parseInt(idStr);
        if (isNaN(id)) { print("Usage: todo vi <id>", 'clr-red'); return; }
        const data = await fetch('/api/get_todo/' + id).then(function(r) { return r.json(); });
        if (!data.success) { print('Todo ' + id + ' not found.', 'clr-red'); return; }
        const t = data.todo;
        if (isEncrypted()) {
            try { t.title = await FlaskyE2EE.decryptField(t.title); } catch(e) {}
            try { t.content = await FlaskyE2EE.decryptField(t.content); } catch(e) {}
        }
        CliVim.open('todo', id, t.title || '', t.content || '');
    }

    async function vimEditEvent(idStr) {
        const id = parseInt(idStr);
        if (isNaN(id)) { print("Usage: event vi <id>", 'clr-red'); return; }
        const data = await fetch('/api/get_event/' + id).then(function(r) { return r.json(); });
        if (!data.success) { print('Event ' + id + ' not found.', 'clr-red'); return; }
        const ev = data.event;
        if (isEncrypted()) {
            try { ev.title = await FlaskyE2EE.decryptField(ev.title); } catch(e) {}
            try { ev.content = await FlaskyE2EE.decryptField(ev.content); } catch(e) {}
        }
        CliVim.open('event', id, ev.title || '', ev.content || '');
    }

    // --- Tab completion ---

    const allCommands = ['clear','cls','help','notes','ls','dir','cat','read','new','touch',
                         'edit','vi','vim','nano','rm','delete','search','grep','find',
                         'rename','revert','categories','dirs','cd','mv','mkdir','rmdir',
                         'todos','todo','events','event','whoami','date','stat','stats',
                         'settings','logout','backlinks','outlinks'];

    function tabComplete() {
        const val = commandInput.value;
        if (!val) return;
        const matches = allCommands.filter(function(c) { return c.startsWith(val.toLowerCase()); });
        if (matches.length === 1) {
            commandInput.value = matches[0] + ' ';
        } else if (matches.length > 1) {
            print('$ ' + val, 'echo-line');
            print(matches.join('  '), 'clr-dim');
        }
    }

    // --- Init ---

    function init(user) {
        username = user;

        commandInput = document.getElementById('command');
        logInner     = document.getElementById('log-inner');
        locationEl   = document.getElementById('location');
        editOverlay  = document.getElementById('edit-overlay');
        editHeader   = document.getElementById('edit-header');
        editTitle    = document.getElementById('edit-title');
        editContent  = document.getElementById('edit-content');

        // Form submit
        document.getElementById('command-form').addEventListener('submit', function(e) { e.preventDefault(); handleAction(); });
        document.getElementById('btn-save').addEventListener('click', function() { saveEdit(); });
        document.getElementById('btn-cancel').addEventListener('click', function() { closeEdit(); });

        // Focus management
        document.addEventListener('DOMContentLoaded', function() { commandInput.focus(); });
        document.addEventListener('click', function(e) {
            if (!editOverlay.classList.contains('active') && !CliVim.isActive()) commandInput.focus();
        });

        // Command history & tab complete
        commandInput.addEventListener('keydown', function(e) {
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (historyIndex > 0) {
                    historyIndex--;
                    commandInput.value = commandHistory[historyIndex];
                }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (historyIndex < commandHistory.length - 1) {
                    historyIndex++;
                    commandInput.value = commandHistory[historyIndex];
                } else {
                    historyIndex = commandHistory.length;
                    commandInput.value = '';
                }
            } else if (e.key === 'Tab') {
                e.preventDefault();
                tabComplete();
            }
        });

        // Editor keyboard shortcuts
        document.addEventListener('keydown', function(e) {
            if (editOverlay.classList.contains('active')) {
                if (e.key === 'Escape') {
                    closeEdit();
                }
                if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    saveEdit();
                }
            }
        });

        // Resize
        function adjustResize() {
            commandInput.style.width = (window.innerWidth - locationEl.offsetWidth - 30) + 'px';
        }
        adjustResize();
        window.addEventListener('resize', adjustResize);

        // Init vim module
        CliVim.init();
        CliVim.setOnSave(vimOnSave);
        CliVim.setOnClose(vimOnClose);

        // Load data & welcome
        (async function() {
            if (typeof FlaskyE2EE !== 'undefined') {
                var ok = await FlaskyE2EE.init();
                if (!ok) return;
            }
            await fetchNotes();
        })();

        print('Welcome to flasky-notes CLI. Type "help" for commands.', 'clr-dim');
        print('');
    }

    window.CliMain = { init: init };
})();
