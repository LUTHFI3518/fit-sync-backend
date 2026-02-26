const { Client, Users, Databases } = require("node-appwrite");
const client = new Client();

client
  .setEndpoint(process.env.APPWRITE_ENDPOINT)
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const users = new Users(client);
const databases = new Databases(client);

module.exports = { users, databases };
