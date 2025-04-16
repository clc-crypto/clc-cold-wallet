#!/usr/bin/env node

const Command = require("commander").Command;
const read = require("read").read;
const CryptoJS = require("crypto-js");
const EC = require("elliptic").ec;
const fs = require("fs");
const os = require("os");
const path = require("path");

const ec = new EC("secp256k1");

const getpass = async (prompt) => {
    return await read({ prompt, silent: true });
};

const input = async (prompt) => {
    return await read({ prompt });
};

function sha256(message) {
    return CryptoJS.SHA256(message).toString(CryptoJS.enc.Hex);
}

const program = new Command();
const savePath = path.join(os.homedir(), ".clc-cold-ses");

program
    .name("clc-cold-wallet")
    .description("Command-line tool for managing local CLC wallets securely")
    .version("1.0.0");

program
    .command("decrypt <path>")
    .description("Decrypt a wallet file and load it into the session")
    .option("-p, --print", "Print wallet contents after decryption")
    .action(async (walletPath, options) => {
        if (fs.existsSync(savePath)) {
            console.log("A wallet is already loaded. Please logout first.");
            return;
        }

        const passwd = await getpass("Enter wallet encryption password: ");
        const decrypted = CryptoJS.AES.decrypt(fs.readFileSync(walletPath, "utf-8"), passwd).toString(CryptoJS.enc.Utf8);

        if (!decrypted.startsWith("{")) {
            console.log("Invalid password.");
            return;
        }

        const wallet = JSON.parse(decrypted);
        console.log(`Wallet loaded. Total coins: ${Object.keys(wallet).length}.`);
        if (options.print) console.log(wallet);
        fs.writeFileSync(savePath, decrypted);
    });

program
    .command("logout <path>")
    .description("Save the current wallet session and encrypt it")
    .action(async (walletPath) => {
        if (!fs.existsSync(savePath)) {
            console.log("No wallet session found. Please decrypt first.");
            return;
        }

        const passwd = await getpass("Enter wallet encryption password: ");
        const confirm = await getpass("Confirm password: ");
        if (passwd !== confirm) {
            console.log("Passwords do not match.");
            return;
        }

        const wallet = fs.readFileSync(savePath, "utf-8");
        fs.writeFileSync(walletPath, CryptoJS.AES.encrypt(wallet, passwd).toString());
        fs.unlinkSync(savePath);
        console.log(`Wallet successfully saved and encrypted to ${walletPath}.`);
    });

program
    .command("balance")
    .description("Check the total balance of the loaded wallet")
    .action(async () => {
        if (!fs.existsSync(savePath)) {
            console.log("No wallet session found. Please decrypt first.");
            return;
        }

        let balance = 0;
        for (const id of Object.keys(JSON.parse(fs.readFileSync(savePath, "utf-8")))) {
            balance += (await (await fetch("https://clc.ix.tc/coin/" + id)).json()).coin.val;
        }

        console.log(`Total wallet balance: ${Math.round(balance * 1000) / 1000} CLC.`);
    });

program
    .command("coins")
    .description("List all coins and associated public keys")
    .option("-v, --validate", "Validate ownership of each coin")
    .option("--val", "Display current value of each coin")
    .action(async (options) => {
        if (!fs.existsSync(savePath)) {
            console.log("No wallet session found. Please decrypt first.");
            return;
        }

        const wallet = JSON.parse(fs.readFileSync(savePath, "utf-8"));
        console.log(`Wallet contains ${Object.keys(wallet).length} coins.`);

        for (const id in wallet) {
            let coin = options.val ? (await (await fetch(`https://clc.ix.tc/coin/${id}`)).json()).coin : null;
            const pub = ec.keyFromPrivate(wallet[id]).getPublic().encode("hex", false);

            let output = `Coin #${id}, Public Key: ${pub}`;
            if (coin) output += `, Value: ${coin.val} CLC`;
            console.log(output);

            if (options.validate) {
                if (!coin) coin = (await (await fetch(`https://clc.ix.tc/coin/${id}`)).json()).coin;
                const isValid = coin.transactions[coin.transactions.length - 1].holder === pub;
                console.log(isValid ? "Valid coin." : "Invalid ownership.");
            }
        }
    });

program
    .command("delete <id>")
    .description("Delete a specific coin from the wallet")
    .option("-c, --confirm", "Skip confirmation prompt")
    .action(async (id, options) => {
        if (!fs.existsSync(savePath)) {
            console.log("No wallet session found. Please decrypt first.");
            return;
        }

        const wallet = JSON.parse(fs.readFileSync(savePath, "utf-8"));
        if (!wallet[id]) {
            console.log("Coin not found in wallet.");
            return;
        }

        if (!options.confirm) {
            const confirmation = await input("Retype the coin ID to confirm deletion: ");
            if (parseInt(confirmation) !== parseInt(id)) {
                console.log("Deletion aborted.");
                return;
            }
        }

        delete wallet[id];
        fs.writeFileSync(savePath, JSON.stringify(wallet));
        console.log("Coin deleted successfully.");
    });

program
    .command("add <cpath>")
    .description("Add a new coin file to the wallet")
    .option("-v, --validate", "Validate coin ownership before adding")
    .action(async (cpath, options) => {
        if (!fs.existsSync(savePath)) {
            console.log("No wallet session found. Please decrypt first.");
            return;
        }

        const coinId = parseInt(path.basename(cpath).split(".")[0]);
        const coinSecret = fs.readFileSync(cpath, "utf-8");

        if (options.validate) {
            const pub = ec.keyFromPrivate(coinSecret).getPublic().encode("hex", false);
            const transactions = (await (await fetch(`https://clc.ix.tc/coin/${coinId}`)).json()).coin.transactions;
            if (transactions[transactions.length - 1].holder !== pub) {
                console.log("Invalid coin. Ownership validation failed.");
                return;
            }
            console.log("Ownership validated. Adding coin...");
        }

        const wallet = JSON.parse(fs.readFileSync(savePath, "utf-8"));
        if (wallet[coinId]) {
            console.log("Coin already exists in wallet.");
            return;
        }

        wallet[coinId] = coinSecret;
        fs.writeFileSync(savePath, JSON.stringify(wallet));
        console.log("Coin added successfully.");
    });

program
    .command("private <id>")
    .description("Display the private key for a given coin ID")
    .action(async (id) => {
        if (!fs.existsSync(savePath)) {
            console.log("No wallet session found. Please decrypt first.");
            return;
        }

        const wallet = JSON.parse(fs.readFileSync(savePath, "utf-8"));
        if (!wallet[id]) {
            console.log("Coin not found in wallet.");
            return;
        }

        console.log(`Private key for coin #${id}: ${wallet[id]}`);
    });

program
    .command("keys")
    .description("Generate a new key pair or derive from an existing private key")
    .option("-p, --private <string>", "Use existing private key")
    .action((options) => {
        const kp = options.private ? ec.keyFromPrivate(options.private) : ec.genKeyPair();
        console.log("Private Key: " + kp.getPrivate().toString("hex"));
        console.log("Public Key: " + kp.getPublic().encode("hex", false));
    });

program
    .command("transact <id> <addr>")
    .description("Send coin <id> to public address <addr>")
    .action(async (id, addr) => {
        if (!fs.existsSync(savePath)) {
            console.log("No wallet session found. Please decrypt first.");
            return;
        }

        const wallet = JSON.parse(fs.readFileSync(savePath, "utf-8"));
        if (!wallet[id]) {
            console.log("Coin not found in wallet.");
            return;
        }

        const key = ec.keyFromPrivate(wallet[id]);
        const sign = key.sign(sha256(addr)).toDER("hex");

        console.log("Submitting transaction...");
        const res = await (await fetch(`https://clc.ix.tc/transaction?cid=${id}&newholder=${addr}&sign=${sign}`)).json();
        if (res.error) {
            console.log("Transaction failed: " + res.error);
        } else {
            delete wallet[id];
            fs.writeFileSync(savePath, JSON.stringify(wallet));
            console.log("Transaction successful. Coin removed from wallet.");
        }
    });

program
    .command("merge <id> <target> <vol>")
    .description("Merge <vol> CLC from coin <id> into coin <target>")
    .action(async (id, target, vol) => {
        if (!fs.existsSync(savePath)) {
            console.log("No wallet session found. Please decrypt first.");
            return;
        }

        const wallet = JSON.parse(fs.readFileSync(savePath, "utf-8"));
        if (!wallet[id]) {
            console.log("Source coin not found in wallet.");
            return;
        }

        const targetCoin = (await (await fetch(`https://clc.ix.tc/coin/${target}`)).json()).coin;
        const key = ec.keyFromPrivate(wallet[id]);
        const sign = key.sign(sha256(`${target} ${targetCoin.transactions.length} ${vol}`)).toDER("hex");

        const res = await (await fetch(`https://clc.ix.tc/merge?origin=${id}&sign=${sign}&target=${target}&vol=${vol}`)).json();
        if (res.error) {
            console.log("Merge failed: " + res.error);
        } else {
            console.log("Merge successful.");
        }
    });

program
    .command("split <id> <vol>")
    .description("Split <vol> CLC from coin <id> into a new coin")
    .action(async (id, vol) => {
        if (!fs.existsSync(savePath)) {
            console.log("No wallet session found. Please decrypt first.");
            return;
        }

        const wallet = JSON.parse(fs.readFileSync(savePath, "utf-8"));
        if (!wallet[id]) {
            console.log("Source coin not found in wallet.");
            return;
        }

        const newId = (await (await fetch("https://clc.ix.tc/ledger-length")).json()).length + 1;
        const key = ec.keyFromPrivate(wallet[id]);
        const sign = key.sign(sha256(`${newId} 1 ${vol}`)).toDER("hex");

        const res = await (await fetch(`https://clc.ix.tc/split?origin=${id}&sign=${sign}&target=${newId}&vol=${vol}`)).json();
        if (res.error) {
            console.log("Split failed: " + res.error);
        } else {
            wallet[newId] = wallet[id];
            fs.writeFileSync(savePath, JSON.stringify(wallet));
            console.log(`Split successful. New coin ID: ${newId}.`);
        }
    });

program.parse(process.argv);