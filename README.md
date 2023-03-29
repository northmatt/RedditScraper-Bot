# RedditScraper
Scrape subreddit for a search results and get a Discord notification when found.


## Installation
You will require [Node.js 14](https://nodejs.org/en/) to run this.

After installing RedditScraper via git or by downloading the code as zip and extracting it, navigate to the RedditScraper directory via powershell (or equivalent console) and run the `npm install` command. Windows has a shortcut where one can shift right click in a given directory and click `Open powershell window here` to open powershell in that directory.

After installing the node modules, run the `npm start` command once to create the configuration file kept in `app_data`. Configure the file as desired.


## Configuration
- `useProxy` {bool} Enables or disables use of proxy.
- `proxy` {string} HTTP/HTTPS/SOCKS proxy address, some formatting examples are 'https:\/\/user:pass@address:port' and 'socks5://address:port'.
- `discordWebHook` {string} Link to discord webhook. Found in Discord Server > Server Settings > Integrations > Webhooks > Create and select desired webhook > 'Copy Webhook URL'
- `discordNotifyGroup` {string} Member or role to ping for general notifications. If pinging role you need to ping the role ID. Goto Discord Server > Server Settings > Roles > Create and select desired role > 'Copy ID' > Format the ID as follows '<@&000000000000000000>'.
- `discordErrorNotifyGroup` {string} Member or role to ping for errors. Do same as above for configuration.
- `subreddit` {string} Subreddit to search. It's capital sensitive.
- `searchTerm` {string} Term to search. If `fastFindMode` is set to `true` then it may require regex formatting (To be determined).
- `focalPoint` {string} If subreddit is a marketplace and has \[H\]\/\[W\] then you can focus on a specific part (Not implemented).
- `fastFindMode` {bool} Controls whether the bot uses the "faster but more bandwidth heavy" or "slower but less bandwidth heavy" method (fastFindMode is not implemented yet).
- `refreshTime` {float} Base wait time in seconds.
- `randomizedWaitCeiling` {float} Extra random time to wait in seconds.
- `headless` {bool} Controls whether the browser is headless or not. Recommended to keep `true` unless for debugging purposes.


## Usage
After installation and configuration, run the `npm start` command to start the bot.

There is a `application.log` file in `app_data` for logging all events, including debugging events which are not displayed in the console.
