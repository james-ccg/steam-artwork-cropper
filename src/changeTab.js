const areas = {
    featured: document.getElementById("featuredArea"),
    artwork: document.getElementById("artworkArea"),
    workshop: document.getElementById("workshopArea"),
    background: document.getElementById("backgroundArea"),
};
const tabButtons = {
    featured: document.getElementById("featuredTab"),
    artwork: document.getElementById("artworkTab"),
    workshop: document.getElementById("workshopTab"),
    background: document.getElementById("backgroundTab"),
};
const tabInfo = require('./tabInfo');
const rightPanel = require('./rightPanel');

const TAB_NAMES = ['featured', 'artwork', 'workshop', 'background'];

/**
 * @param {'featured'|'artwork'|'workshop'|'background'} tabName
 * @param {Function} callback Load image function, only run the first time this tab is shown
 */
function changeTab(tabName, callback) {
    TAB_NAMES.forEach(function (name) {
        if (name === tabName) areas[name].style.removeProperty("display");
        else areas[name].style.setProperty("display", "none");

        rightPanel[name + 'Info'][name === tabName ? 'show' : 'hide']();
        if (tabButtons[name]) tabButtons[name].classList.toggle('active', name === tabName);
    });

    tabInfo.currentTab = "#" + tabName;
    if (!tabInfo.loaded[tabName]) {
        // Latch first so a synchronous re-entry can't double-load, but release
        // the latch if the loader rejects. Without that, a first visit whose
        // demo fetch failed leaves the tab marked loaded forever and it keeps
        // showing its placeholder markup with a "-" readout.
        tabInfo.loaded[tabName] = true;
        const pending = callback();
        if (pending && typeof pending.catch === "function") {
            pending.catch(function () {
                tabInfo.loaded[tabName] = false;
            });
        }
    }
}

module.exports = changeTab;
