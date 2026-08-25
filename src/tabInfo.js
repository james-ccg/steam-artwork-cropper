// Used for tracking which tab is selected and which showcase is loaded
const tabInfo = {
    currentTab: '#artwork',
    artworkLoaded: false,
    workshopLoaded: false,
    reset: function() {
        this.artworkLoaded = false;
        this.workshopLoaded = false;
    }
}

module.exports = tabInfo;