import { REST, Routes } from "discord.js";
import { loadConfig } from "./config.js";
import { buildAdapterCommands, buildBotCommands } from "./commands.js";

const config = loadConfig();
const rest = new REST({ version: "10" }).setToken(config.discordToken);
const body = [...buildAdapterCommands(), ...buildBotCommands()].map((command) => command.toJSON());
if (body.length > 100) {
  throw new Error(`Discord supports at most 100 guild slash commands per application. Tried to register ${body.length}.`);
}

await rest.put(Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId), { body });
console.log(`Registered ${body.length} guild slash commands.`);
