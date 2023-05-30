import { S3 } from "aws-sdk";
import fetch from "node-fetch";
import FormData from "form-data";
import admin, { ServiceAccount } from "firebase-admin";
import { SQSEvent } from "aws-lambda";

import serviceAccount from "./serviceAccount.json";

const customPrompt = `Eres ResumenGPT, tu trabajo es dar un resumen del texto que recibas y dar información  complementaria con enlaces de referencia en caso de ser posible. 
Tarea: Vas a dar un resumen del  siguiente texto y luego proporcionar bullet points de los puntos más importantes del resumen. 
ResumenGPT siempre entrega un output siguien esa estructura: <h2>Resumen</h2> <p>resumen del texto en menos de 100 palabras</p> <h2>Bullet points</h2><ul><li>dar bullet points de los puntos clave del resumen</li></ul>
<h2>Links de referencia</h2>: <a href="Referencias externas" /> || <span>"no aplica"</span>`;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount as ServiceAccount),
});

const db = admin.firestore();
const nameSeparator = "-separator-";

export async function main(event: SQSEvent) {
  const s3 = new S3();
  const { Records } = event;

  if (!Records) return console.log("No records found");

  const allRecords = Records.map((childRecord) => {
    return JSON.parse(childRecord.body).Records.map((record: any) => record.s3);
  })
    .filter(Boolean)
    .flat(1);

  try {
    const promises = allRecords.map(async (record) => {
      const fileName = record.object.key;
      const bucketName = record.bucket.name;
      const splitedRecord = record.object.key.split(nameSeparator);

      const uid = splitedRecord[0];
      const documentId = splitedRecord[1];

      const audioObject = await s3
        .getObject({ Bucket: bucketName, Key: fileName })
        .promise();

      const audioContent = audioObject.Body;
      const transcription = await transcribeAudio(audioContent, fileName);
      console.log("Transcription", transcription);
      const summary = await makeSummary(String(transcription));

      await saveSummaryInFirestore(
        uid,
        String(transcription),
        summary,
        documentId
      );

      await s3.deleteObject({ Bucket: bucketName, Key: fileName }).promise();
    });

    await Promise.all(promises);

    return {
      statusCode: 200,
      body: JSON.stringify("ok"),
    };
  } catch (err: any) {
    console.log("Error in file transcription", err.message);
  }
}

const transcribeAudio = async (audioContent: any, fileName: string) => {
  const formData = new FormData();

  formData.append("file", audioContent, {
    filename: fileName,
  });

  formData.append("model", "whisper-1");
  formData.append("language", "es");

  return await new Promise(async (resolve, reject) => {
    fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      body: formData,
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        ...formData.getHeaders(),
      },
    })
      .then((res) => res.json())
      .catch((err) => {
        console.log("Error sending audio to whisper");
        reject(err);
      })
      .then(async (transcription: any) => {
        resolve(transcription.text);
      });
  });
};

const makeSummary = async (transcription: string) => {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "user",
            content: `${customPrompt} ${transcription}`,
          },
        ],
        temperature: 0.7,
      }),
    });

    const data = (await response.json()) as any;

    return data.choices.length ? data.choices[0].message.content : null;
  } catch (err) {
    console.log("Error summarizing", err);
    return null;
  }
};

const saveSummaryInFirestore = async (
  uid: string,
  transcription: string,
  summary: string,
  documentId: string
) => {
  try {
    const newRegister = {
      uid,
      summary,
      transcription,
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await db
      .collection(`users/${uid}/summaries`)
      .doc(documentId)
      .update(newRegister);

    console.log("Register added:", newRegister);
    return true;
  } catch (err) {
    console.log("Error adding register", err);
    return false;
  }
};
