// Used for tracking which tab is selected and which showcase is loaded
const tabInfo = {
    currentTab: '#artwork',
    loaded: { featured: false, artwork: false, workshop: false, background: false },
    reset: function() {
        this.loaded.featured = false;
        this.loaded.artwork = false;
        this.loaded.workshop = false;
        this.loaded.background = false;
    }
}

module.exports = tabInfo;
