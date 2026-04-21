import knex from "knex"

const conn = knex({
  client: "pg",
  connection: "postgresql://dev:dev@localhost:5432/app",
})

const admins = await conn.select("*").from("admin")
console.log(admins)
