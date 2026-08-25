const areas = {
    featured: document.getElementById("featuredArea"),
    artwork: document.getElementById("artworkArea"),
    workshop: document.getElementById("workshopArea"),
    avatar: document.getElementById("avatarArea"),
};
const tabButtons = {
    featured: document.getElementById("featuredTab"),
    artwork: document.getElementById("artworkTab"),
    workshop: document.getElementById("workshopTab"),
    avatar: document.getElementById("avatarTab"),
};
const tabInfo = require('./tabInfo');
const rightPanel = require('./rightPanel');

const TAB_NAMES = ['featured', 'artwork', 'workshop', 'avatar'];

/**
 * @param {'featured'|'artwork'|'workshop'|'avatar'} tabName
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
        callback();
        tabInfo.loaded[tabName] = true;
    }
}

module.exports = changeTab;
