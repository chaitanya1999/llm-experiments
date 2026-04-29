import { AdminClient, ChromaClient } from "chromadb";
import { getConfig, describeRuntime } from "../config.js";

function parseArgs(argv) {
	return {
		yes: argv.includes("--yes"),
		deleteDatabases: argv.includes("--delete-databases"),
	};
}

function chromaConnection(config) {
	const url = new URL(config.vector.chroma.path);

	return {
		host: url.hostname,
		port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
		ssl: url.protocol === "https:",
	};
}

async function ignoreAlreadyExists(operation) {
	try {
		await operation();
	} catch (error) {
		const message = String(error?.message ?? "").toLowerCase();
		if (!message.includes("already") && !message.includes("exists") && !message.includes("unique")) {
			throw error;
		}
	}
}

async function ensureTenantAndDatabase(adminClient, { tenant, database }) {
	await ignoreAlreadyExists(() => adminClient.createTenant({ name: tenant }));
	await ignoreAlreadyExists(() => adminClient.createDatabase({ name: database, tenant }));
}

async function deleteAllCollectionsInDatabase(connection, { tenant, database }) {
	const client = new ChromaClient({
		...connection,
		tenant,
		database,
	});
	const collections = await client.listCollections({ limit: 1000, offset: 0 });

	for (const collection of collections) {
		await client.deleteCollection({ name: collection.name });
		console.log(`Deleted collection ${tenant}/${database}/${collection.name}`);
	}

	return collections.length;
}

async function deleteDatabasesForTenant(adminClient, connection, tenant, keepDatabase) {
	const databases = await adminClient.listDatabases({ tenant, limit: 1000, offset: 0 });

	for (const database of databases) {
		const databaseName = database.name;

		if (databaseName === keepDatabase) {
			await deleteAllCollectionsInDatabase(connection, { tenant, database: databaseName });
			continue;
		}

		await adminClient.deleteDatabase({ name: databaseName, tenant });
		console.log(`Deleted database ${tenant}/${databaseName}`);
	}
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const config = getConfig();
	const connection = chromaConnection(config);
	const tenant = config.vector.chroma.tenant;
	const database = config.vector.chroma.database;

	console.log("Knowledge Graph POC Chroma clear");
	console.log(JSON.stringify({
		...describeRuntime(config),
		mode: options.deleteDatabases ? "delete-databases" : "reset",
	}, null, 2));

	if (!options.yes) {
		console.log("");
		console.log("Refusing to clear Chroma without --yes.");
		console.log("Use one of:");
		console.log("  npm run kg:clear-chroma -- --yes");
		console.log("  npm run kg:clear-chroma -- --yes --delete-databases");
		process.exitCode = 1;
		return;
	}

	const adminClient = new AdminClient(connection);

	if (options.deleteDatabases) {
		await deleteDatabasesForTenant(adminClient, connection, tenant, database);
		await ensureTenantAndDatabase(adminClient, { tenant, database });
		console.log(`Chroma databases cleared for tenant ${tenant}. Kept/recreated ${database}.`);
		return;
	}

	const client = new ChromaClient({
		...connection,
		tenant,
		database,
	});

	await client.reset();
	await ensureTenantAndDatabase(adminClient, { tenant, database });
	console.log("Chroma reset complete.");
	console.log(`Ensured ${tenant}/${database} exists for the application.`);
}

main().catch((error) => {
	console.error("Knowledge Graph POC Chroma clear failed.");
	console.error(error.message);
	process.exit(1);
});
