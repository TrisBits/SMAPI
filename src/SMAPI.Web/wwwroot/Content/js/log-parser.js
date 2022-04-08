/* globals $ */

var smapi = smapi || {};
var app;
var messages;


// Necessary helper method for updating our text filter in a performant way.
// Wouldn't want to update it for every individually typed character.
function debounce(fn, delay) {
    var timeoutID = null
    return function () {
        clearTimeout(timeoutID)
        var args = arguments
        var that = this
        timeoutID = setTimeout(function () {
            fn.apply(that, args)
        }, delay)
    }
}

// Case insensitive text searching and match word searching is best done in
// regex, so if the user isn't trying to use regex, escape their input.
function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Use a scroll event to apply a sticky effect to the filters / pagination
// bar. We can't just use "position: sticky" due to how the page is structured
// but this works well enough.
$(function () {
    let sticking = false;

    document.addEventListener('scroll', function (event) {
        const filters = document.getElementById('filters');
        const holder = document.getElementById('filterHolder');
        if (!filters || !holder)
            return;

        const offset = holder.offsetTop;
        const should_stick = window.pageYOffset > offset;
        if (should_stick === sticking)
            return;

        sticking = should_stick;
        if (sticking) {
            holder.style.marginBottom = `calc(1em + ${filters.offsetHeight}px)`;
            filters.classList.add('sticky');
        } else {
            filters.classList.remove('sticky');
            holder.style.marginBottom = '';
        }
    });
});

// This method is called when we click a log line to toggle the visibility
// of a section. Binding methods is problematic with functional components
// so we just use the `data-section` parameter and our global reference
// to the app.
smapi.clickLogLine = function (event) {
    app.toggleSection(event.currentTarget.dataset.section);
    event.preventDefault();
    return false;
}

// And these methods are called when doing pagination. Just makes things
// easier, so may as well use helpers.
smapi.prevPage = function () {
    app.prevPage();
}

smapi.nextPage = function () {
    app.nextPage();
}

smapi.changePage = function (event) {
    if (typeof event === 'number')
        app.changePage(event);
    else if (event) {
        const page = parseInt(event.currentTarget.dataset.page);
        if (!isNaN(page) && isFinite(page))
            app.changePage(page);
    }
}


smapi.logParser = function (data, sectionUrl) {
    if (!data)
        data = {};

    // internal filter counts
    var stats = data.stats = {
        modsShown: 0,
        modsHidden: 0
    };

    function updateModFilters() {
        // counts
        stats.modsShown = 0;
        stats.modsHidden = 0;
        for (var key in data.showMods) {
            if (data.showMods.hasOwnProperty(key)) {
                if (data.showMods[key])
                    stats.modsShown++;
                else
                    stats.modsHidden++;
            }
        }
    }

    // load our data

    // Rather than pre-rendering the list elements into the document, we read
    // a lot of JSON and use Vue to build the list. This is a lot more
    // performant and easier on memory.Our JSON is stored in special script
    // tags, that we later remove to let the browser clean up even more memory.
    let nodeParsedMessages = document.querySelector('script#parsedMessages');
    if (nodeParsedMessages) {
        messages = JSON.parse(nodeParsedMessages.textContent) || [];
        const logLevels = JSON.parse(document.querySelector('script#logLevels').textContent) || {};
        const logSections = JSON.parse(document.querySelector('script#logSections').textContent) || {};
        const modSlugs = JSON.parse(document.querySelector('script#modSlugs').textContent) || {};

        // Remove all references to the script tags and remove them from the
        // DOM so that the browser can clean them up.
        nodeParsedMessages.remove();
        document.querySelector('script#logLevels').remove();
        document.querySelector('script#logSections').remove();
        document.querySelector('script#modSlugs').remove();
        nodeParsedMessages = null;

        // Pre-process the messages since they aren't quite serialized in
        // the format we want. We also want to freeze every last message
        // so that Vue won't install its change listening behavior.
        for (let i = 0, length = messages.length; i < length; i++) {
            const msg = messages[i];
            msg.id = i;
            msg.LevelName = logLevels && logLevels[msg.Level];
            msg.SectionName = logSections && logSections[msg.Section];
            msg.ModSlug = modSlugs && modSlugs[msg.Mod] || msg.Mod;

            // For repeated messages, since our <log-line /> component
            // can't return two rows, just insert a second message
            // which will display as the message repeated notice.
            if (msg.Repeated > 0 && ! msg.isRepeated) {
                const second = {
                    id: i + 1,
                    Level: msg.Level,
                    Section: msg.Section,
                    Mod: msg.Mod,
                    Repeated: msg.Repeated,
                    isRepeated: true,
                };

                messages.splice(i + 1, 0, second);
                length++;
            }

            Object.freeze(msg);
        }

        Object.freeze(messages);

    } else
        messages = [];

    // set local time started
    if (data.logStarted)
        data.localTimeStarted = ("0" + data.logStarted.getHours()).slice(-2) + ":" + ("0" + data.logStarted.getMinutes()).slice(-2);

    // Add some properties to the data we're passing to Vue.
    data.totalMessages = messages.length;

    data.filterText = '';
    data.filterRegex = '';

    data.showContentPacks = true;
    data.useHighlight = true;
    data.useRegex = false;
    data.useInsensitive = true;
    data.useWord = false;

    data.perPage = 1000;
    data.page = 1;

    // Now load these values.
    if (localStorage.settings) {
        try {
            const saved = JSON.parse(localStorage.settings);
            if (saved.hasOwnProperty('showContentPacks'))
                data.showContentPacks = saved.showContentPacks;
            if (saved.hasOwnProperty('useHighlight'))
                dat.useHighlight = saved.useHighlight;
            if (saved.hasOwnProperty('useRegex'))
                data.useRegex = saved.useRegex;
            if (saved.hasOwnProperty('useInsensitive'))
                data.useInsensitive = saved.useInsensitive;
            if (saved.hasOwnProperty('useWord'))
                data.useWord = saved.useWord;
        } catch { /* ignore errors */ }
    }

    // This would be easier if we could just use JSX but this project doesn't
    // have a proper JavaScript build environment and I really don't feel
    // like setting one up.

    // Add a number formatter so that our numbers look nicer.
    const fmt = window.Intl && Intl.NumberFormat && new Intl.NumberFormat();
    function formatNumber(value) {
        if (!fmt || !fmt.format) return `${value}`;
        return fmt.format(value);
    }
    Vue.filter('number', formatNumber);

    // Strictly speaking, we don't need this. However, due to the way our
    // Vue template is living in-page the browser is "helpful" and moves
    // our <log-line />s outside of a basic <table> since obviously they
    // aren't table rows and don't belong inside a table. By using another
    // Vue component, we avoid that.
    Vue.component('log-table', {
        functional: true,
        render: function (createElement, context) {
            return createElement('table', {
                attrs: {
                    id: 'log'
                }
            }, context.children);
        }
    });

    // The <filter-stats /> component draws a nice message under the filters
    // telling a user how many messages match their filters, and also expands
    // on how many of them they're seeing because of pagination.
    Vue.component('filter-stats', {
        functional: true,
        render: function (createElement, context) {
            const props = context.props;
            if (props.pages > 1)
                return createElement('div', {
                    class: 'stats'
                }, [
                    'showing ',
                    createElement('strong', formatNumber(props.start + 1)),
                    ' to ',
                    createElement('strong', formatNumber(props.end)),
                    ' of ',
                    createElement('strong', formatNumber(props.filtered)),
                    ' (total: ',
                    createElement('strong', formatNumber(props.total)),
                    ')'
                ]);

            return createElement('div', {
                class: 'stats'
            }, [
                'showing ',
                createElement('strong', formatNumber(props.filtered)),
                ' out of ',
                createElement('strong', formatNumber(props.total))
            ]);
        }
    });

    // Next up we have <pager /> which renders the pagination list. This has a
    // helper method to make building the list of links easier.
    function addPageLink(page, links, visited, createElement, currentPage) {
        if (visited.has(page))
            return;

        if (page > 1 && !visited.has(page - 1))
            links.push(' … ');

        visited.add(page);
        links.push(createElement('span', {
            class: page == currentPage ? 'active' : null,
            attrs: {
                'data-page': page
            },
            on: {
                click: smapi.changePage
            }
        }, formatNumber(page)));
    }

    Vue.component('pager', {
        functional: true,
        render: function (createElement, context) {
            const props = context.props;
            if (props.pages <= 1)
                return null;

            const visited = new Set;
            const pageLinks = [];

            for (let i = 1; i <= 2; i++)
                addPageLink(i, pageLinks, visited, createElement, props.page);

            for (let i = props.page - 2; i <= props.page + 2; i++) {
                if (i < 1 || i > props.pages)
                    continue;

                addPageLink(i, pageLinks, visited, createElement, props.page);
            }

            for (let i = props.pages - 2; i <= props.pages; i++) {
                if (i < 1)
                    continue;

                addPageLink(i, pageLinks, visited, createElement, props.page);
            }

            return createElement('div', {
                class: 'pager'
            }, [
                createElement('span', {
                    class: props.page <= 1 ? 'disabled' : null,
                    on: {
                        click: smapi.prevPage
                    }
                }, 'Prev'),
                ' ',
                'Page ',
                formatNumber(props.page),
                ' of ',
                formatNumber(props.pages),
                ' ',
                createElement('span', {
                    class: props.page >= props.pages ? 'disabled' : null,
                    on: {
                        click: smapi.nextPage
                    }
                }, 'Next'),
                createElement('div', {}, pageLinks)
            ]);
        }
    });

    // Our <log-line /> functional component draws each log line.
    Vue.component('log-line', {
        functional: true,
        props: {
            showScreenId: {
                type: Boolean,
                required: true
            },
            message: {
                type: Object,
                required: true
            },
            sectionExpanded: {
                type: Boolean,
                required: false
            },
            highlight: {
                type: Boolean,
                required: false
            }
        },
        render: function (createElement, context) {
            const msg = context.props.message;
            const level = msg.LevelName;

            if (msg.isRepeated)
                return createElement('tr', {
                    class: [
                        "mod",
                        level,
                        "mod-repeat"
                    ]
                }, [
                    createElement('td', {
                        attrs: {
                            colspan: context.props.showScreenId ? 4 : 3
                        }
                    }, ''),
                    createElement('td', `repeats ${msg.Repeated} times`)
                ]);

            const events = {};
            let toggleMessage;
            if (msg.IsStartOfSection) {
                const visible = context.props.sectionExpanded;
                events.click = smapi.clickLogLine;
                toggleMessage = visible ?
                    'This section is shown. Click here to hide it.' :
                    'This section is hidden. Click here to show it.';
            }

            let text = msg.Text;
            const filter = window.app && app.filterRegex;
            if (text && filter && context.props.highlight) {
                text = [];
                let match, consumed = 0, idx = 0;
                filter.lastIndex = -1;

                // Our logic to highlight the text is a bit funky because we
                // want to group consecutive matches to avoid a situation
                // where a ton of single characters are in their own elements
                // if the user gives us bad input.

                while (match = filter.exec(msg.Text)) {
                    // Do we have an area of non-matching text? This
                    // happens if the new match's index is further
                    // along than the last index.
                    if (match.index > idx) {
                        // Alright, do we have a previous match? If
                        // we do, we need to consume some text.
                        if (consumed < idx)
                            text.push(createElement('strong', {}, msg.Text.slice(consumed, idx)));

                        text.push(msg.Text.slice(idx, match.index));
                        consumed = match.index;
                    }

                    idx = match.index + match[0].length;
                }

                // Add any trailing text after the last match was found.
                if (consumed < msg.Text.length) {
                    if (consumed < idx)
                        text.push(createElement('strong', {}, msg.Text.slice(consumed, idx)));

                    if (idx < msg.Text.length)
                        text.push(msg.Text.slice(idx));
                }
            }

            return createElement('tr', {
                class: [
                    "mod",
                    level,
                    msg.IsStartOfSection ? "section-start" : null
                ],
                attrs: {
                    'data-section': msg.SectionName
                },
                on: events
            }, [
                createElement('td', msg.Time),
                context.props.showScreenId ? createElement('td', msg.ScreenId) : null,
                createElement('td', level.toUpperCase()),
                createElement('td', {
                    attrs: {
                        'data-title': msg.Mod
                    }
                }, msg.Mod),
                createElement('td', [
                    createElement('span', {
                        class: 'log-message-text'
                    }, text),
                    msg.IsStartOfSection ? createElement('span', {
                        class: 'section-toggle-message'
                    }, [
                        ' ',
                        toggleMessage
                    ]) : null
                ])
            ]);
        }
    });

    // init app
    app = new Vue({
        el: '#output',
        data: data,
        computed: {
            anyModsHidden: function () {
                return stats.modsHidden > 0;
            },
            anyModsShown: function () {
                return stats.modsShown > 0;
            },
            showScreenId: function () {
                return this.screenIds.length > 1;
            },

            // Maybe not strictly necessary, but the Vue template is being
            // weird about accessing data entries on the app rather than
            // computed properties.
            visibleSections: function () {
                const ret = [];
                for (const [k, v] of Object.entries(this.showSections))
                    if (v !== false)
                        ret.push(k);
                return ret;
            },
            hideContentPacks: function () {
                return !data.showContentPacks;
            },

            // Filter messages for visibility.
            filterUseRegex: function () { return data.useRegex; },
            filterInsensitive: function () { return data.useInsensitive; },
            filterUseWord: function () { return data.useWord; },
            shouldHighlight: function () { return data.useHighlight; },

            filteredMessages: function () {
                if (!messages)
                    return [];

                const start = performance.now();
                const ret = [];

                // This is slightly faster than messages.filter(), which is
                // important when working with absolutely huge logs.
                for (let i = 0, length = messages.length; i < length; i++) {
                    const msg = messages[i];
                    if (msg.SectionName && !msg.IsStartOfSection && !this.sectionsAllow(msg.SectionName))
                        continue;

                    if (!this.filtersAllow(msg.ModSlug, msg.LevelName))
                        continue;

                    let text = msg.Text || (i > 0 ? messages[i - 1].Text : null);

                    if (this.filterRegex) {
                        this.filterRegex.lastIndex = -1;
                        if (!text || !this.filterRegex.test(text))
                            continue;
                    } else if (this.filterText && (!text || text.indexOf(this.filterText) == -1))
                        continue;

                    ret.push(msg);
                }

                const end = performance.now();
                console.log(`filter took ${end - start}ms`);

                return ret;
            },

            // And the rest are about pagination.
            start: function () {
                return (this.page - 1) * data.perPage;
            },
            end: function () {
                return this.start + this.visibleMessages.length;
            },
            totalPages: function () {
                return Math.ceil(this.filteredMessages.length / data.perPage);
            },
            // 
            visibleMessages: function () {
                if (this.totalPages <= 1)
                    return this.filteredMessages;

                const start = this.start;
                const end = start + data.perPage;

                return this.filteredMessages.slice(start, end);
            }
        },
        created: function () {
            this.loadFromUrl = this.loadFromUrl.bind(this);
            window.addEventListener('popstate', this.loadFromUrl);
            this.loadFromUrl();
        },
        methods: {
            // Mostly I wanted people to know they can override the PerPage
            // message count with a URL parameter, but we can read Page too.
            // In the future maybe we should read *all* filter state so a
            // user can link to their exact page state for someone else?
            loadFromUrl: function () {
                const params = new URL(location).searchParams;
                if (params.has('PerPage'))
                    try {
                        const perPage = parseInt(params.get('PerPage'));
                        if (!isNaN(perPage) && isFinite(perPage) && perPage > 0)
                            data.perPage = perPage;
                    } catch { /* ignore errors */ }

                if (params.has('Page'))
                    try {
                        const page = parseInt(params.get('Page'));
                        if (!isNaN(page) && isFinite(page) && page > 0)
                            this.page = page;
                    } catch { /* ignore errors */ }
            },

            toggleLevel: function (id) {
                if (!data.enableFilters)
                    return;

                this.showLevels[id] = !this.showLevels[id];
            },

            toggleContentPacks: function () {
                data.showContentPacks = !data.showContentPacks;
                this.saveSettings();
            },

            toggleFilterUseRegex: function () {
                data.useRegex = !data.useRegex;
                this.saveSettings();
                this.updateFilterText();
            },

            toggleFilterInsensitive: function () {
                data.useInsensitive = !data.useInsensitive;
                this.saveSettings();
                this.updateFilterText();
            },

            toggleFilterWord: function () {
                data.useWord = !data.useWord;
                this.saveSettings();
                this.updateFilterText();
            },

            toggleHighlight: function () {
                data.useHighlight = !data.useHighlight;
                this.saveSettings();
            },

            prevPage: function () {
                if (this.page <= 1)
                    return;
                this.page--;
                this.updateUrl();
            },

            nextPage: function () {
                if (this.page >= this.totalPages)
                    return;
                this.page++;
                this.updateUrl();
            },

            changePage: function (page) {
                if (page < 1 || page > this.totalPages)
                    return;
                this.page = page;
                this.updateUrl();
            },

            // Persist settings into localStorage for use the next time
            // the user opens a log.
            saveSettings: function () {
                localStorage.settings = JSON.stringify({
                    showContentPacks: data.showContentPacks,
                    useRegex: data.useRegex,
                    useInsensitive: data.useInsensitive,
                    useWord: data.useWord,
                    useHighlight: data.useHighlight
                });
            },

            // Whenever the page is changed, replace the current page URL. Using
            // replaceState rather than pushState to avoid filling the tab history
            // with tons of useless history steps the user probably doesn't
            // really care about.
            updateUrl: function () {
                const url = new URL(location);
                url.searchParams.set('Page', data.page);
                url.searchParams.set('PerPage', data.perPage);

                window.history.replaceState(null, document.title, url.toString());
            },

            // We don't want to update the filter text often, so use a debounce with
            // a quarter second delay. We basically always build a regular expression
            // since we use it for highlighting, and it also make case insensitivity
            // much easier.
            updateFilterText: debounce(function () {
                let text = this.filterText = document.querySelector('input[type=text]').value;
                if (!text || !text.length) {
                    this.filterText = '';
                    this.filterRegex = null;
                } else {
                    if (!data.useRegex)
                        text = escapeRegex(text);
                    this.filterRegex = new RegExp(
                        data.useWord ? `\\b${text}\\b` : text,
                        data.useInsensitive ? 'ig' : 'g'
                    );
                }
            }, 250),

            toggleMod: function (id) {
                if (!data.enableFilters)
                    return;

                var curShown = this.showMods[id];

                // first filter: only show this by default
                if (stats.modsHidden === 0) {
                    this.hideAllMods();
                    this.showMods[id] = true;
                }

                // unchecked last filter: reset
                else if (stats.modsShown === 1 && curShown)
                    this.showAllMods();

                // else toggle
                else
                    this.showMods[id] = !this.showMods[id];

                updateModFilters();
            },

            toggleSection: function (name) {
                if (!data.enableFilters)
                    return;

                this.showSections[name] = !this.showSections[name];
            },

            showAllMods: function () {
                if (!data.enableFilters)
                    return;

                for (var key in this.showMods) {
                    if (this.showMods.hasOwnProperty(key)) {
                        this.showMods[key] = true;
                    }
                }
                updateModFilters();
            },

            hideAllMods: function () {
                if (!data.enableFilters)
                    return;

                for (var key in this.showMods) {
                    if (this.showMods.hasOwnProperty(key)) {
                        this.showMods[key] = false;
                    }
                }
                updateModFilters();
            },

            filtersAllow: function (modId, level) {
                return this.showMods[modId] !== false && this.showLevels[level] !== false;
            },

            sectionsAllow: function (section) {
                return this.showSections[section] !== false;
            }
        }
    });

    /**********
    ** Upload form
    *********/
    var input = $("#input");
    if (input.length) {
        // file upload
        smapi.fileUpload({
            chooseFileLink: $("#choose-file-link"),
            chooseFileInput: $("#inputFile"),
            contentArea: input,
            submitButton: $("#submit")
        });
    }
};
