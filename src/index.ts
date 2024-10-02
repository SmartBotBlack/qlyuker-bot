import axios from "axios";
import "colors";
import { input, select } from "@inquirer/prompts";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import Database from "better-sqlite3";
import env from "./env";
import { HttpsProxyAgent } from "https-proxy-agent";

const db = new Database("accounts.db");

const ensureTableExists = () => {
  const tableExists = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='accounts';"
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
        `
    ).run();
  }
};

const _headers = {
  accept: "*/*",
  "accept-language": "en-US,en;q=0.9,ru-RU;q=0.8,ru;q=0.7",
  "cache-control": "no-cache",
  "content-type": "application/json",
  locale: "ru",
  onboarding: "0",
  pragma: "no-cache",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  tgplatform: "ios",
  Referer: "https://qlyuker.io/",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

const generateIOSUserAgent = (): string => {
  const iOSVersions = [
    "14_0",
    "14_1",
    "14_2",
    "14_3",
    "14_4",
    "14_5",
    "14_6",
    "14_7",
    "14_8",
    "15_0",
    "15_1",
    "15_2",
    "15_3",
    "15_4",
    "15_5",
    "15_6",
    "16_0",
    "16_1",
    "16_2",
    "16_3",
    "16_4",
    "17_0",
  ];
  const iPhoneModels = [
    "iPhone12,1",
    "iPhone12,3",
    "iPhone12,5",
    "iPhone13,1",
    "iPhone13,2",
    "iPhone13,3",
    "iPhone13,4",
    "iPhone14,2",
    "iPhone14,3",
    "iPhone14,4",
    "iPhone14,5",
  ];
  const safariVersions = [
    "602.1",
    "603.1",
    "604.1",
    "605.1.15",
    "605.2.15",
    "605.3.8",
  ];

  const getRandomElement = <T>(array: T[]): T =>
    array[Math.floor(Math.random() * array.length)];

  const iOSVersion = getRandomElement(iOSVersions);
  const iPhoneModel = getRandomElement(iPhoneModels);
  const safariVersion = getRandomElement(safariVersions);

  return `Mozilla/5.0 (${iPhoneModel}; CPU iPhone OS ${iOSVersion} like Mac OS X) AppleWebKit/${safariVersion} (KHTML, like Gecko) Version/${
    iOSVersion.split("_")[0]
  }.0 Mobile/15E148 Safari/${safariVersion}`;
};

const createSession = async (phoneNumber: string, proxy: string) => {
  try {
    const client = new TelegramClient(
      new StringSession(""),
      env.APP_ID,
      env.API_HASH,
      {
        deviceModel: env.DEVICE_MODEL,
        connectionRetries: 5,
      }
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
      "INSERT INTO accounts (phoneNumber, session, proxy) VALUES (@phoneNumber, @session, @proxy)"
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
  const stmt = db.prepare(`DELETE FROM accounts WHERE id=(@id)`).run({ id });
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
    }
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
      })
    );
    if (!webview || !webview.url) {
      console.log("Failed to get webview URL.".red);
      return;
    }
    const query = decodeURIComponent(
      webview.url.split("&tgWebAppVersion=")[0].split("#tgWebAppData=")[1]
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
  proxy,
}: {
  queryId: string;
  userAgent: string;
  proxy: string;
}) => {
  const url = "https://qlyuker.io/api/auth/start";
  const headers = { ..._headers, "User-Agent": userAgent };

  const payload = {
    startData: queryId,
  };

  const res = await axios.post(
    url,
    payload,
    proxy ? { headers, httpsAgent: new HttpsProxyAgent(proxy) } : { headers }
  );

  let cookies = "";

  const setCookieHeaders = res.headers["set-cookie"];
  if (setCookieHeaders) {
    const newCookies = setCookieHeaders.map(
      (cookie: string) => cookie.split(";")[0]
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
  proxy,
  payload,
}: {
  cookies: string;
  userAgent: string;
  proxy: string;
  payload: {
    clientTime: number;
    currentEnergy: number;
    taps: number;
  };
}) => {
  const url = "https://qlyuker.io/api/game/sync";
  const headers = { ..._headers, cookie: cookies, "User-Agent": userAgent };

  const res = await axios.post(
    url,
    payload,
    proxy ? { headers, httpsAgent: new HttpsProxyAgent(proxy) } : { headers }
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
  const userAgent = generateIOSUserAgent();

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
      } = await getCookie({ queryId, userAgent, proxy });
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
                (energyPerSec + (energy < maxEnergy * 0.5 ? 0 : 1))
            ) / coinsPerTap
          ) || 1;
        console.log(prefix, `Tapped ${newTaps} times`);
        let newCurrentEnergy =
          energy + randomSecWait * energyPerSec - newTaps * coinsPerTap;
        newCurrentEnergy = Math.min(newCurrentEnergy, 0);
        newCurrentEnergy = Math.max(newCurrentEnergy, maxEnergy);

        const { currentEnergy, currentCoins } = await sync({
          cookies,
          userAgent,
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
          `${currentCoins}`.green
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
        `${"Error farm:".red} ${error.code} ${error.message}`
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
