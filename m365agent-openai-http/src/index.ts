import app from "./app/app";

// Start the application
(async () => {
  await app.start(process.env.PORT || process.env.port || 3979);
  console.log(`\nAgent started, app listening to`, process.env.PORT || process.env.port || 3979);
})();
