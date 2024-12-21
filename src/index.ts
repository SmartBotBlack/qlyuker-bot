import axios from "axios";
import "colors";
import { input, select } from "@inquirer/prompts";
import Database from "better-sqlite3";
import { HttpsProxyAgent } from "https-proxy-agent";
import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import env from "./env";

const db = new Database("accounts.db");

const ensureTableExists = () => {
	const tableExists = db
		.prepare(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='accounts';",
		)
		.get();

	if (!tableExists) {
		db.prepare(
			`
            CREATE TABLE accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phoneNumber TEXT,
                session TEXT,
                proxy TEXT
            );
        `,
		).run();
	}
};

const _headers = {
	accept: "*/*",
	"accept-encoding": "gzip, deflate, br, zstd",
	"accept-language": "ru,ru-RU;q=0.9,en-US;q=0.8,en;q=0.7",
	connection: "keep-alive",
	"content-type": "application/json",
	host: "qlyuker.io",
	klyuk: "0110101101101100011011110110111101101011",
	locale: "ru",
	onboarding: "0",
	origin: "https://qlyuker.io",
	referer: "https://qlyuker.io/",
	"sec-ch-ua-mobile": "?1",
	"sec-ch-ua-platform": '"Android"',
	"sec-fetch-dest": "empty",
	"sec-fetch-mode": "cors",
	"sec-fetch-site": "same-origin",
	tgplatform: "android",
	"x-requested-with": "org.telegram.messenger",
};

function generateAndroidUserAgentAndSecChUa() {
	const chromeVersions = [106, 107, 108, 109, 110];
	const majorChromeVersion =
		chromeVersions[Math.floor(Math.random() * chromeVersions.length)];
	const userAgent = `Mozilla/5.0 (Linux; Android 11; Pixel 5 Build/RQ3A.210905.001) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${majorChromeVersion}.0.0.0 Mobile Safari/537.36`;
	const secChUa = `"Android WebView";v="${majorChromeVersion}", "Not=A?Brand";v="8", "Chromium";v="${majorChromeVersion}"`;
	return { userAgent, secChUa };
}

const createSession = async (phoneNumber: string, proxy: string) => {
	try {
		const client = new TelegramClient(
			new StringSession(""),
			env.APP_ID,
			env.API_HASH,
			{
				deviceModel: env.DEVICE_MODEL,
				connectionRetries: 5,
			},
		);

		await client.start({
			phoneNumber: async () => phoneNumber,
			password: async () => await input({ message: "Enter your password:" }),
			phoneCode: async () =>
				await input({ message: "Enter the code you received:" }),
			onError: (err: Error) => {
				if (
					!err.message.includes("TIMEOUT") &&
					!err.message.includes("CastError")
				) {
					console.log(`Telegram authentication error: ${err.message}`.red);
				}
			},
		});

		console.log("Successfully created a new session!".green);
		const stringSession = client.session.save() as unknown as string;

		db.prepare(
			"INSERT INTO accounts (phoneNumber, session, proxy) VALUES (@phoneNumber, @session, @proxy)",
		).run({ phoneNumber, session: stringSession, proxy });

		await client.sendMessage("me", {
			message: "Successfully created a new session!",
		});
		console.log("Saved the new session to session file.".green);
		await client.disconnect();
		await client.destroy();
	} catch (e) {
		const error = e as Error;
		if (
			!error.message.includes("TIMEOUT") &&
			!error.message.includes("CastError")
		) {
			console.log(`Error: ${error.message}`.red);
		}
	}
};

const showAllAccounts = async () => {
	const stmt = db.prepare("SELECT id, phoneNumber, proxy FROM accounts");
	const arr = [];
	for (const row of stmt.iterate()) {
		arr.push(row);
		console.log(row);
	}
	return arr;
};

const deleteAccount = async (id: number) => {
	const stmt = db.prepare("DELETE FROM accounts WHERE id=(@id)").run({ id });
	console.log(`Account ${id} is delete`);
};

const getQueryId = async (phoneNumber: string, session: string) => {
	const client = new TelegramClient(
		new StringSession(session),
		env.APP_ID,
		env.API_HASH,
		{
			deviceModel: env.DEVICE_MODEL,
			connectionRetries: 5,
		},
	);

	await client.start({
		phoneNumber: async () => phoneNumber,
		password: async () => await input({ message: "Enter your password:" }),
		phoneCode: async () =>
			await input({ message: "Enter the code you received:" }),
		onError: (err: Error) => {
			if (
				!err.message.includes("TIMEOUT") &&
				!err.message.includes("CastError")
			) {
				console.log(`Telegram authentication error: ${err.message}`.red);
			}
		},
	});

	try {
		const peer = await client.getInputEntity("qlyukerbot");
		if (!peer) {
			console.log("Failed to get peer entity.".red);
			return;
		}
		const webview = await client.invoke(
			new Api.messages.RequestWebView({
				peer,
				bot: peer,
				fromBotMenu: false,
				platform: "ios",
				url: "https://qlyuker.io/",
			}),
		);
		if (!webview || !webview.url) {
			console.log("Failed to get webview URL.".red);
			return;
		}
		const query = decodeURIComponent(
			webview.url.split("&tgWebAppVersion=")[0].split("#tgWebAppData=")[1],
		);

		return query;
	} catch (e) {
		console.log(`Error retrieving query data: ${(e as Error).message}`.red);
	} finally {
		await client.disconnect();
		await client.destroy();
	}
};

const getRandomInt = (min: number, max: number) =>
	Math.floor(Math.random() * (max - min + 1)) + min;

const extractUserData = (queryId: string) => {
	const urlParams = new URLSearchParams(queryId);
	const user = JSON.parse(decodeURIComponent(urlParams.get("user") ?? ""));
	return {
		extUserId: user.id,
		extUserName: user.username,
	};
};

const getCookie = async ({
	queryId,
	userAgent,
	secChUa,
	proxy,
}: {
	queryId: string;
	userAgent: string;
	secChUa: string;
	proxy: string;
}) => {
	const url = "https://qlyuker.io/api/auth/start";
	const headers = {
		..._headers,
		"User-Agent": userAgent,
		"sec-ch-ua": secChUa,
	};

	const payload = {
		startData: queryId,
	};

	const res = await axios.post(
		url,
		payload,
		proxy ? { headers, httpsAgent: new HttpsProxyAgent(proxy) } : { headers },
	);

	let cookies = "";

	const setCookieHeaders = res.headers["set-cookie"];
	if (setCookieHeaders) {
		const newCookies = setCookieHeaders.map(
			(cookie: string) => cookie.split(";")[0],
		);
		cookies += cookies ? `; ${newCookies.join("; ")}` : newCookies.join("; ");
	}

	return {
		cookies,
		...res.data,
	};
};

const sync = async ({
	cookies,
	userAgent,
	secChUa,
	proxy,
	payload,
}: {
	cookies: string;
	userAgent: string;
	secChUa: string;
	proxy: string;
	payload: {
		clientTime: number;
		currentEnergy: number;
		taps: number;
	};
}) => {
	const url = "https://qlyuker.io/api/game/sync";
	const headers = {
		..._headers,
		cookie: cookies,
		"User-Agent": userAgent,
		"sec-ch-ua": secChUa,
	};

	const res = await axios.post(
		url,
		payload,
		proxy ? { headers, httpsAgent: new HttpsProxyAgent(proxy) } : { headers },
	);

	return res.data;
};

const farm = async (account: {
	phoneNumber: string;
	session: string;
	proxy: string;
}) => {
	const { phoneNumber, session, proxy } = account;
	const queryId = await getQueryId(phoneNumber, session);
	const { userAgent, secChUa } = generateAndroidUserAgentAndSecChUa();

	if (!queryId) {
		console.log(`Failed to get query data for ${phoneNumber}`.red);
		return;
	}

	const { extUserId } = extractUserData(queryId);
	const prefix = `[${extUserId}]`.blue;

	while (true) {
		try {
			const {
				cookies,
				user: { coinsPerTap, currentEnergy, maxEnergy, energyPerSec },
			} = await getCookie({ queryId, userAgent, secChUa, proxy });
			let energy = currentEnergy;

			const timeForFullenergy = (maxEnergy - energy) / energyPerSec;
			await new Promise((res) => setTimeout(res, timeForFullenergy * 1e3));
			energy = maxEnergy;

			const sessionTime = getRandomInt(1, 50);

			for (let i = 0; i < sessionTime; i++) {
				const randomSecWait = getRandomInt(10, 60);
				console.log(prefix, `Taps for ${randomSecWait} seconds...`);
				await new Promise((res) => setTimeout(res, randomSecWait * 1e3));

				const newTaps =
					Math.floor(
						getRandomInt(
							randomSecWait * (energyPerSec - 1),
							randomSecWait *
								(energyPerSec + (energy < maxEnergy * 0.5 ? 0 : 1)),
						) / coinsPerTap,
					) || 1;
				console.log(prefix, `Tapped ${newTaps} times`);
				let newCurrentEnergy =
					energy + randomSecWait * energyPerSec - newTaps * coinsPerTap;
				newCurrentEnergy = Math.min(newCurrentEnergy, 0);
				newCurrentEnergy = Math.max(newCurrentEnergy, maxEnergy);

				const { currentEnergy, currentCoins } = await sync({
					cookies,
					userAgent,
					secChUa,
					proxy,
					payload: {
						clientTime: Math.floor(Date.now() / 1e3),
						currentEnergy: newCurrentEnergy,
						taps: newTaps,
					},
				});

				console.log(
					prefix,
					"Current energy:",
					currentEnergy,
					", coins:",
					`${currentCoins}`.green,
				);

				energy = currentEnergy;
			}

			const sleep = getRandomInt(60, 30 * 60);

			console.log(prefix, `Sleeping for ${sleep} seconds...`);

			await new Promise((res) => setTimeout(res, sleep * 1e3));
		} catch (e) {
			const error = e as Error & { code?: string };
			console.log(
				prefix,
				`${"Error farm:".red} ${error.code} ${error.message}`,
			);
			await new Promise((res) => setTimeout(res, 60 * 1e3));
		}
	}
};

const start = async () => {
	const stmt = db.prepare("SELECT phoneNumber, session, proxy FROM accounts");
	const accounts = [...stmt.iterate()] as {
		phoneNumber: string;
		session: string;
		proxy: string;
	}[];

	await Promise.all(accounts.map(farm));
};

(async () => {
	ensureTableExists();

	while (true) {
		const mode = await select({
			message: "Please choose an option:",
			choices: [
				{
					name: "Start farming",
					value: "start",
					description: "Start playing game",
				},
				{
					name: "Add account",
					value: "add",
					description: "Add new account to DB",
				},
				{
					name: "Show all accounts",
					value: "show",
					description: "show all added accounts",
				},
				{
					name: "Delete account",
					value: "delete",
					description: "delete account",
				},
			],
		});

		switch (mode) {
			case "add": {
				const phoneNumber = await input({
					message: "Enter your phone number (+):",
				});

				const proxy = await input({
					message:
						"Enter proxy (in format http://username:password@host:port):",
				});

				await createSession(phoneNumber, proxy);
				break;
			}
			case "show": {
				showAllAccounts();
				break;
			}
			case "start": {
				await start();
				break;
			}
			case "delete": {
				const allAccounts = await showAllAccounts();
				const choicesArr = allAccounts.map((el) => {
					//@ts-ignore
					const { id } = el;
					return { name: `id: ${id}`, value: id };
				});

				const accountId = await select({
					message: "Select an account to delete:",
					choices: choicesArr,
				});

				await deleteAccount(accountId);
				break;
			}
			default:
				break;
		}
	}
})();
