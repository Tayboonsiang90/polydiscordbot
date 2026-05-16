import { REST, Routes } from "discord.js";
import { loadConfig } from "./config.js";
import { buildAdapterCommands, buildBotCommands } from "./commands.js";

const config = loadConfig();
const rest = new REST({ version: "10" }).setToken(config.discordToken);
const body = [...buildAdapterCommands(), ...buildBotCommands()].map((command) => command.toJSON());

await rest.put(Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId), { body });
console.log("Registered guild slash commands.");
