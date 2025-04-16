"use strict";
const Command = require("commander").Command;
const read = require("read").read;
const CryptoJS = require("crypto-js");
const EC = require("elliptic").ec;
const fs = require("fs");
const os = require("os");
const path = require("path");
const ec = new EC("secp256k1");
const getpass = async (prompt) => {
    return await read({ prompt: prompt, silent: true });
};
const input = async (prompt) => {
    return await read({ prompt: prompt });
};
function sha256(message) {
    return CryptoJS.SHA256(message).toString(CryptoJS.enc.Hex);
}
const program = new Command();
const savePath = path.join(os.homedir(), ".clc-cold-ses");
program
    .name('clc-cold-wallet')
    .description('A CLI tool made to store CLCs locally')
    .version('1.0.0');
program
    .command('decrypt <path>')
    .description('Decrypt a .wallet file and load it to do operations on')
    .option("-p, --print")
    .action(async (path, options) => {
    if (fs.existsSync(savePath))
        return console.log("Wallet already loaded, please logout");
    const passwd = await getpass("Enter wallet encryption password >");
    const decryptedWallet = CryptoJS.AES.decrypt(fs.readFileSync(path, "utf-8"), passwd).toString(CryptoJS.enc.Utf8);
    if (!decryptedWallet.startsWith("{")) {
        console.log("\nInvalid password!");
        return;
    }
    console.log(`\nWallet contains ${Object.keys(JSON.parse(decryptedWallet)).length} coins.`);
    if (options.print)
        console.log(JSON.parse(decryptedWallet));
    fs.writeFileSync(savePath, decryptedWallet);
});
program
    .command('logout <path>')
    .description('Decrypt a .wallet file and load it to do operations on')
    .action(async (path) => {
    if (!fs.existsSync(savePath))
        return console.log("Wallet not loaded yet, please decrypt");
    const passwd = await getpass("Enter wallet encryption password >");
    console.log();
    const passwdChk = await getpass("Retype wallet encryption password >");
    if (passwd !== passwdChk)
        return console.log("\nPasswords don't match!");
    const wallet = fs.readFileSync(savePath, "utf-8");
    fs.writeFileSync(path, CryptoJS.AES.encrypt(wallet, passwd).toString());
    fs.unlinkSync(savePath);
    console.log("\nSuccessfully saved and encrypted wallet to " + path + "!");
});
program
    .command('ballance')
    .description('Get the ballance of your wallet')
    .action(async () => {
    if (!fs.existsSync(savePath))
        return console.log("Wallet not loaded yet, please decrypt");
    let bal = 0;
    for (const coinId of Object.keys(JSON.parse(fs.readFileSync(savePath, "utf-8")))) {
        bal += (await (await fetch("https://clc.ix.tc/coin/" + coinId)).json()).coin.val;
    }
    console.log("Total wallet ballance " + Math.round(bal * 1000) / 1000 + "CLC");
});
program
    .command('coins')
    .description('Get all coins and public keys in your wallet')
    .option("-v, --validate")
    .option("--val")
    .action(async (options) => {
    if (!fs.existsSync(savePath))
        return console.log("Wallet not loaded yet, please decrypt");
    const wallet = JSON.parse(fs.readFileSync(savePath, "utf-8"));
    console.log("Wallet contains " + Object.keys(wallet).length + " coins,");
    for (const coinId in wallet) {
        let coin = options.val ? (await (await fetch("https://clc.ix.tc/coin/" + coinId)).json()).coin : null;
        const pub = ec.keyFromPrivate(wallet[coinId]).getPublic().encode("hex", false);
        console.log("#" + coinId + ", " + pub + (coin ? `, ${coin.val}CLC` : ""));
        if (options.validate) {
            if (!coin)
                coin = (await (await fetch("https://clc.ix.tc/coin/" + coinId)).json()).coin;
            const transactions = coin.transactions;
            if (transactions[transactions.length - 1].holder === pub)
                console.log("Valid.");
            else
                console.log("Invalid!");
        }
    }
});
program
    .command('delete <id>')
    .description('Permanently delete a coin from your wallet')
    .option("-c, --confirm")
    .action(async (id, options) => {
    if (!fs.existsSync(savePath))
        return console.log("Wallet not loaded yet, please decrypt");
    const wallet = JSON.parse(fs.readFileSync(savePath, "utf-8"));
    if (!wallet[id])
        return console.log("You do not have this coin in this wallet!");
    if (!options.confirm) {
        if (parseInt(await input("Please retype the coin id you want to delete >")) !== parseInt(id))
            return console.log("Aborting!");
        console.log("Confirmed.");
    }
    delete wallet[id];
    fs.writeFileSync(savePath, JSON.stringify(wallet));
    console.log("Done.");
});
program
    .command("add <cpath>")
    .description("Add a .coin file to your wallet")
    .option("-v, --validate")
    .action(async (cpath, options) => {
    if (!fs.existsSync(savePath))
        return console.log("Wallet not loaded yet, please decrypt");
    const coinId = parseInt(path.basename(cpath).split(".")[0]);
    if (options.validate) {
        const pub = ec.keyFromPrivate(fs.readFileSync(cpath, "utf-8")).getPublic().encode("hex", false);
        const transactions = (await (await fetch("https://clc.ix.tc/coin/" + coinId)).json()).coin.transactions;
        if (transactions[transactions.length - 1].holder === pub)
            console.log("Valid coin, adding...");
        else
            return console.log("Invalid coin!");
    }
    const wallet = JSON.parse(fs.readFileSync(savePath, "utf-8"));
    if (wallet[coinId])
        return console.log("Coin already in wallet!");
    wallet[coinId] = fs.readFileSync(cpath, "utf-8");
    fs.writeFileSync(savePath, JSON.stringify(wallet));
    console.log("Done.");
});
program
    .command("private <id>")
    .description("Get secret of coin <id>")
    .action(async (id) => {
    if (!fs.existsSync(savePath))
        return console.log("Wallet not loaded yet, please decrypt");
    const wallet = JSON.parse(fs.readFileSync(savePath, "utf-8"));
    if (!wallet[id])
        return console.log("Coin not in wallet!");
    console.log(wallet[id]);
});
program
    .command("keys")
    .description("Generate a pair of public and private keys")
    .option("-p, --private <string>")
    .action(async (options) => {
    let kp = null;
    if (!options.private)
        kp = ec.genKeyPair();
    else
        kp = ec.keyFromPrivate(options.private);
    console.log("Private: " + kp.getPrivate().toString("hex"));
    console.log("Public: " + kp.getPublic().encode("hex", false));
});
program
    .command("transact <id> <addr>")
    .description("Transact coin <id> to address <addr>")
    .action(async (id, addr) => {
    if (!fs.existsSync(savePath))
        return console.log("Wallet not loaded yet, please decrypt");
    const wallet = JSON.parse(fs.readFileSync(savePath, "utf-8"));
    if (!wallet[id])
        return console.log("This coin is not in your wallet");
    const key = ec.keyFromPrivate(wallet[id]);
    const sign = key.sign(sha256(addr)).toDER("hex");
    console.log("Generated signature for transaction to " + addr + ",\n" + sign + ", transacting...");
    const res = await (await fetch("https://clc.ix.tc/transaction?cid=" + id + "&newholder=" + addr + "&sign=" + sign)).json();
    if (res.error)
        console.log("Error transacting, " + res.error);
    else {
        delete wallet[id];
        fs.writeFileSync(savePath, JSON.stringify(wallet));
        console.log("Done, deleted from wallet!");
    }
});
program
    .command("merge <id> <target> <vol>")
    .description("Mergo <vol> of coin <id> CLCs into coin <target>")
    .action(async (id, target, vol) => {
    if (!fs.existsSync(savePath))
        return console.log("Wallet not loaded yet, please decrypt");
    const wallet = JSON.parse(fs.readFileSync(savePath, "utf-8"));
    if (!wallet[id])
        return console.log("This coin is not in your wallet");
    console.log("Fetching data...");
    const targetCoin = (await (await fetch("https://clc.ix.tc/coin/" + target)).json()).coin;
    const key = ec.keyFromPrivate(wallet[id]);
    const sign = key.sign(sha256(`${target} ${targetCoin.transactions.length} ${vol}`)).toDER("hex");
    console.log("Merging...");
    const res = await (await fetch(`https://clc.ix.tc/merge?origin=${id}&sign=${sign}&target=${target}&vol=${vol}`)).json();
    if (res.error)
        console.log("Error merging coin, " + res.error);
    else
        console.log("Done!");
});
program
    .command("split <id> <vol>")
    .description("Spli off <vol> CLCs from coin <id>")
    .action(async (id, vol) => {
    if (!fs.existsSync(savePath))
        return console.log("Wallet not loaded yet, please decrypt");
    const wallet = JSON.parse(fs.readFileSync(savePath, "utf-8"));
    if (!wallet[id])
        return console.log("This coin is not in your wallet");
    console.log("Fetching data...");
    const ll = (await (await fetch("https://clc.ix.tc/ledger-length")).json()).length + 1;
    const key = ec.keyFromPrivate(wallet[id]);
    const sign = key.sign(sha256(`${ll} 1 ${vol}`)).toDER("hex");
    console.log("Splitting...");
    const res = await (await fetch(`https://clc.ix.tc/split?origin=${id}&sign=${sign}&target=${ll}&vol=${vol}`)).json();
    if (res.error)
        console.log("Error splitting coin, " + res.error);
    else {
        wallet[ll] = wallet[id];
        fs.writeFileSync(savePath, JSON.stringify(wallet));
        console.log("New id, #" + ll);
        console.log("Done!");
    }
});
program.parse(process.argv);
