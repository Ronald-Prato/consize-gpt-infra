// Put object in s3 bucket

import { APIGatewayProxyEvent } from "aws-lambda";
import serviceAccount from "./serviceAccount.json";
import admin, { ServiceAccount } from "firebase-admin";

export async function main(event: APIGatewayProxyEvent) {
  const buff = Buffer.from(event.body!, "base64");
  const eventBodyStr = buff.toString("utf-8");
  const payload = JSON.parse(eventBodyStr);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as ServiceAccount),
  });

  const db = admin.firestore();

  try {
    const { uid, email } = payload;

    const newUserStruct = {
      uid,
      email,
    };

    await db.collection("users").doc(uid).set(newUserStruct);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "User created successfully",
      }),
    };
  } catch (err: any) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: "Error creating user",
      }),
    };
  }
}
