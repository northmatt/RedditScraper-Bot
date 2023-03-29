const puppeteer = require('puppeteer-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth');
const useProxy = require('puppeteer-page-proxy');
const randomUseragent = require("random-useragent");
const log4js = require('log4js');
const fs = require('fs');
const { Webhook, MessageBuilder } = require('discord-webhook-node');
const slowSearchFetch = require('./SearchFetchSlow.json');
const fastSearchFetch = require('./SearchFetchFast.json');

log4js.configure({
	appenders: {
		cout: { type: 'stdout' },
		log_file: { type: 'file', filename: 'app_data/application.log', maxLogSize: '4M', backups: 10, compress: true },
		logLevelFilter: { type: 'logLevelFilter', level: 'info', appender: 'cout' }
	},
	categories: {
		default: { appenders: [ 'log_file', 'logLevelFilter' ], level: 'all' }
	}
});

const logger = log4js.getLogger("Reddit Bot");
let config = null;
let discordWebhook = null;

const miscInfo = {"errCnt": 0, "state": 0, "lastPostDate": "", "authHeadersIndex": 0, "authHeaders": [], "pageCDPSession": null};

/**
 * Tries to find the config file, creates one if one doesnt exist, and does basic error checking on the config file
*/
async function FindConfigFile() {
	try {
		config = require('../app_data/config.json');
	}
	catch (err) {
		logger.error("No config file found");
		fs.copyFile('src/config_template.json', 'app_data/config.json', (err) => {
			if (err)
				throw err;
		});
		logger.info("Created new config file. Please set values");
		return false;
	}
	
	if (config.useProxy && config.proxy == "") {
		logger.error("Configuration file has bad proxy settings");
		return false;
	}
	
	//Consider allowing searchTerm having an empty value?
	if (config.subreddit == "" || config.searchTerm == "") {
		logger.error("Configuration file has bad reddit settings");
		return false;
	}
	
	return true;
}

/**
 * Waits for a dynamic timeout based on the config refresh_time/randomized_wait_ceiling and timeVariable
 * @page 			{page}	Page one wants to target
 * @doRandomTime 	{bool}	Whether to have a dynamic or static waittime
 * @timeVariable	{float}	Add addition time (dynamic) or set total time (static)
*/
async function DynamicTimeout(page, doRandomTime = true, timeVariable = 0) {
	const nextCheckInSeconds = doRandomTime ? (config.refreshTime + Math.random() * config.randomizedWaitCeiling + timeVariable).toFixed(2) : (timeVariable);
	logger.info(`The next attempt will be performed in ${nextCheckInSeconds} seconds`);

	await page.waitForTimeout(nextCheckInSeconds * 1000);
}

/**
 * Sends an HTTP request via the fetch protocol
 * @page 			{page}	Page one wants to target
 * @fetchInput	 	{JSON}	Fetch request
*/
async function GetFetch(page, fetchInput) {
	const fetchOutput = await page.evaluate(async (fetchInput) => {
		//looks in options for TimeOut var, defaults to 20s
		const { timeout = 20000 } = fetchInput.options;

		//setup and start AbortController with a timeout
		const controller = new AbortController();
		const id = setTimeout(() => controller.abort(), timeout);

		//do fetch as normal but link AbortController so fetch knows when to abort
		const response = await fetch(fetchInput.url, {...fetchInput.options, signal: controller.signal});
		clearTimeout(id);

		const statusCode = response.status;
		const jsonData = (statusCode == 200) ? await response.json() : null;
		return await {"json":jsonData, "statusCode":statusCode};
	}, fetchInput);
	
	return fetchOutput;
}

/**
 * Sends a Discord notification
 * @notifType 		{int}		Type of notification to send
 * @notifInfo		{object}	Additional details
*/
async function DiscordNotif(notifType = 0, notifInfo = null) {
	if (discordWebhook == null) {
		logger.error("No Discord webhook available");
		return;
	}
	
	const embed = new MessageBuilder()
		.setThumbnail('https://raw.githubusercontent.com/jef/streetmerchant/main/docs/assets/images/streetmerchant-logo.png')
		.setColor('#52b788')
		.setTimestamp();

	switch (notifType) {
		case 0:
			embed.setTitle('_**Fatal Error Alert!**_');
			embed.setText(config.discordNotifyGroup);
			embed.setDescription('> Fatal error occured');

			break;
		case 1:
			embed.setTitle('_**Repeated Error Alert!**_');
			embed.setText(config.discordErrorNotifyGroup);
			embed.setDescription('> 3+ consecutive errors');

			break;
		case 2:
			embed.setTitle('_**Post Found Alert!**_');
			embed.setText(config.discordNotifyGroup);
			embed.setDescription(`> ${notifInfo.title}`);
			embed.addField('Post ID', `${notifInfo.id}`, true);
			embed.addField('Post Timestamp', `${notifInfo.createdAt.substring(0, 19)}`, true);
			embed.addField('Post Author', `${notifInfo.author}`, true);
			embed.setURL(`${notifInfo.url}`);

			break;
		default:
			break;
	}

	try {
		discordWebhook.send(embed);
	}
	catch (err) {
		logger.error(`DN >> ${err.message}`);
	}
}

/**
 * Clears browser cache, local storage, and session storage
 * @page 			{page}		Page to target
*/
async function ClearPageData(page) {
	//Clear browser storage
	await page.evaluate(() => {
		localStorage.clear();
		sessionStorage.clear();
	});

	//Clear browser cookies
	if (miscInfo.pageCDPSession == null)
		miscInfo.pageCDPSession = await page.target().createCDPSession();

	await miscInfo.pageCDPSession.send('Network.clearBrowserCookies');
}

async function InitFastFindMode(page) {
	//SUBREDDIT_AREA	config.subreddit
	fastSearchFetch.url = fastSearchFetch.urlTemplate.replace("SUBREDDIT_AREA", `${config.subreddit}`);

	//-flair:\<[^\s]+\>
	//flair:\<[^\s]+\>

	const tempSearch = config.searchTerm.split(' ');

	return false;
}

async function InitSlowFindMode(page) {
	if (miscInfo.authHeaders.length < 2) {
		//Need mutliple auth tokens, each token is semi-limited to one search per 5 - 10 minutes
		//Search is also limited by other things
		logger.info(`Only ${miscInfo.authHeaders.length} auth tokens collected, gathering more...`);

		await ClearPageData(page);

		return false;
	}

	logger.info(`Finished collecting auth tokens. Collected ${miscInfo.authHeaders.length} auth tokens.`);
	slowSearchFetch.options.headers.authorization = miscInfo.authHeaders[miscInfo.authHeadersIndex];
	
	//SEARCH_AREA		config.searchTerm
	//SUBREDDIT_AREA	config.subreddit
	//BODY_ID_AREA		35022e8cc9cf
	//QUERY_ID_AREA		e625ce6f-050c-4687-912a-e0f605fe7590
	slowSearchFetch.options.body = slowSearchFetch.urlTemplate.replaceAll("BODY_ID_AREA", "35022e8cc9cf").replaceAll("QUERY_ID_AREA", "e625ce6f-050c-4687-912a-e0f605fe7590").replaceAll("SUBREDDIT_AREA", `${config.subreddit}`).replaceAll("SEARCH_AREA", `${config.searchTerm}`);
	
	return true;
}

async function RunFastFindMode(page, fetchOutput) {
	//fetchJSON.posts[fetchJSON.postIds[0]].created			{int}
	//fetchJSON.posts[fetchJSON.postIds[0]].title			{string}
	//fetchJSON.posts[fetchJSON.postIds[0]].flair[1].text	{string}

	return false;
}

async function RunSlowFindMode(page, rawPostInfo) {
	//Change slowSearchFetch authorization header
	miscInfo.authHeadersIndex++;
	if (miscInfo.authHeadersIndex >= miscInfo.authHeaders.length)
		miscInfo.authHeadersIndex = 0;

	slowSearchFetch.options.headers.authorization = miscInfo.authHeaders[miscInfo.authHeadersIndex];

	await ClearPageData(page);

	logger.debug(`Changed slowSearchFetch header auth: ${slowSearchFetch.options.headers.authorization}`);
	
	if (rawPostInfo.data.search.general.posts == null || rawPostInfo.data.search.general.posts.edges[0].node == null)
		return null;
	
	const postInfo = rawPostInfo.data.search.general.posts.edges[0].node;

	//New check equal to previous check, previous check empty (start of program), incase most recent post was deleted
	const newPost = !(miscInfo.lastPostDate == postInfo.createdAt || miscInfo.lastPostDate == "" || Date.parse(postInfo.createdAt) < Date.parse(miscInfo.lastPostDate));

	return {"id":postInfo.id, "title":postInfo.title, "createdAt":postInfo.createdAt, "author":postInfo.authorInfo.name, "url":postInfo.url, "newPost":newPost};
}

async function InitBrowser() {
	const UA = randomUseragent.getRandom(function (ua) {
		return (ua.osName == "Windows" || ua.osName == "Linux") &&
			(ua.browserName == "Opera" && parseFloat(ua.browserVersion) >= 47) ||
			(ua.browserName == "Chrome" && parseFloat(ua.browserVersion) >= 60) ||
			(ua.browserName == "Chromium" && parseFloat(ua.browserVersion) >= 60) ||
			(ua.browserName == "Edge" && parseFloat(ua.browserVersion) >= 14) ||
			(ua.browserName == "Firefox" && parseFloat(ua.browserVersion) >= 45)
	});

	//launch browser with stealth stuff & widescreen to avoid mobile view
	puppeteer.use(stealthPlugin());
	const browser = await puppeteer.launch({
		headless: config.headless,
		defaultViewport: { width: 854, height: 480 }
	});
	const page = await browser.newPage();

	let pages = await browser.pages();
	pages[0].close();

	return page;
}

async function InitPages(page) {
	//blockers and proxy
	await page.setRequestInterception(true);
	await page.on('request', async(request) => {
		const typ = request.resourceType();
		if (typ === 'font' || typ === 'image') {
			await request.abort();
			return;
		}

		//Need to update to reddit stuff
		const reqURL = request.url();
		const ref = request.headers()['referer'];
		if (ref != null && (ref.includes("ca/checkout/?qit=1") || ref == "https://www.bestbuy.ca/") && (reqURL.includes("google-analytics.com/") || reqURL.includes("assets.adobedtm.com/") || reqURL.includes("ca/staticweb"))) {
			await request.abort();
			return;
		}

		if (!config.fastFindMode && slowSearchFetch.options.headers.authorization == "" && ref != null && (ref == "https://www.reddit.com" || ref == "https://www.reddit.com/") && (reqURL == "https://gql.reddit.com" || reqURL == "https://gql.reddit.com/")) {
			const currentAuthHeader = request.headers().authorization;

			if (miscInfo.authHeaders.length == 0 || currentAuthHeader != miscInfo.authHeaders[miscInfo.authHeaders.length - 1]) {
				const lastAuthHeadersIndex = miscInfo.authHeaders.push(currentAuthHeader) - 1;
				logger.debug(`New slowSearchFetch header auth: ${miscInfo.authHeaders[lastAuthHeadersIndex]}`);
			}
		}

		if (!config.useProxy) {
			await request.continue();
			return;
		}

		try {
			await useProxy(request, config.proxy);
		} catch (err) {
			logger.error(`page >> ${err.message}`);
			await request.abort();
		}
	});
}

async function InitSite(page) {
	initSiteLabel: try {
		await page.goto(`https://www.reddit.com/r/${config.subreddit}`, { timeout: 120000, waitUntil: 'networkidle2' });
		
		if (config.fastFindMode ? !(await InitFastFindMode(page)) : !(await InitSlowFindMode(page)))
			break initSiteLabel;

		return true;
	} catch (err) {
		logger.error(`IS >> ${err.message}`);
	}
	
	return false;
}

async function MainLoop(page) {
	var randomizeWaittime = true;
	var addedWaitime = 0;

	mainLoopLabel: try {
		if (miscInfo.errCnt > 2) {
			miscInfo.errCnt = 0;
			logger.warn("Three consecutive errors, sending Discord notification");
			DiscordNotif(1);
			break mainLoopLabel;
		}

		if (!page.url().includes(`r/${config.subreddit}`)) {
			logger.info("Incorrect page, loading page");
			await page.goto(`https://www.reddit.com/r/${config.subreddit}`, { timeout: 120000, waitUntil: 'networkidle2' });
			logger.debug("Finished loading page");
		}

		if (!config.fastFindMode && slowSearchFetch.options.headers.authorization == "") {
			logger.error("slowSearchFetch authorization header is empty");

			miscInfo.errCnt++;

			randomizeWaittime = false;
			addedWaitime = 5.0;

			break mainLoopLabel;
		}

		const fetchOutput = await GetFetch(page, config.fastFindMode ? fastSearchFetch : slowSearchFetch);

		//status 200 is good, anything else is from an error
		if (fetchOutput.statusCode != 200) {
			//401 is bad fetch auth (Old/NA)?
			//422 is bad fetch body (missing ID)?
			logger.error(`ML >> Fetch Failed with code ${fetchOutput.statusCode}`);

			miscInfo.errCnt++;

			//Incase fetchError is from too many requests
			addedWaitime = (config.refreshTime + config.randomizedWaitCeiling) * miscInfo.errCnt;

			break mainLoopLabel;
		}

		const postInfo = config.fastFindMode ? (await RunFastFindMode(page, fetchOutput.json)) : (await RunSlowFindMode(page, fetchOutput.json));

		miscInfo.errCnt = 0;

		if (postInfo == null) {
			logger.warn(`No new posts found`);
			break mainLoopLabel;
		}

		if (!postInfo.newPost) {
			logger.warn(`No new posts found (Last upload date: ${postInfo.createdAt.substring(0, 19)})`);
			miscInfo.lastPostDate = postInfo.createdAt;
			break mainLoopLabel;
		}

		miscInfo.lastPostDate = postInfo.createdAt;

		logger.info(`Post ${postInfo.id} uploaded at ${postInfo.createdAt.substring(11, 19)}, sending Discord notification`);
		DiscordNotif(2, postInfo);
	} catch (err) {
		logger.error(`ML >> ${err.message}`);
		miscInfo.errCnt++;
	}

	await DynamicTimeout(page, randomizeWaittime, addedWaitime);
	return false;
}

async function Main() {
	logger.info("Reddit Scraping Bot Started");

	if (!await FindConfigFile())
		return;

	logger.info(`Watching: ${config.subreddit}`);
	logger.info(`Search: ${config.searchTerm}`);

	if (config.discordWebHook != "https://discord.com/api/webhooks/000000000000000000/XXX_XXXXXXXX_XXXXXXXXXXXXXXXXXXXXXXXXXX-XXXXXXXXXXXXXXXXXXXXXXXXXXXX")
		discordWebhook = new Webhook(config.discordWebHook);

	const page = await InitBrowser();

	InitPages(page);

	while (miscInfo.state < 2) {
		switch (miscInfo.state) {
			case 0:
				if (await InitSite(page))
					miscInfo.state++;

				break;
			case 1:
				if (await MainLoop(page))
					miscInfo.state++;

				break;
			default:
				break;
		}
	}

	await page.browser().close();
}

async function Run() {
	try {
		await Main();
	} catch (err) {
		logger.error(`Run >> ${err.message}`);
		DiscordNotif(0);
	}

	log4js.shutdown();
}

Run();