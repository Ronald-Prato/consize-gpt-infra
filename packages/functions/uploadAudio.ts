// Put object in s3 bucket

import fs from "fs";
import { S3 } from "aws-sdk";
import { exec } from "child_process";
import { APIGatewayProxyEvent } from "aws-lambda";

const replaceFilename = (filename: string) => {
  const splitedFilename =
    filename.split("-separator-")[filename.split("-separator-").length - 1];
  const fileFormat =
    splitedFilename.split(".")[splitedFilename.split(".").length - 1];

  const newFilename = filename.replace(`.${fileFormat}`, ".mp3");

  return newFilename;
};

const convertAudio = async (
  audioContent: Buffer,
  format: string
): Promise<Buffer | null> => {
  const audioPath = `/tmp/input_audio.${format}`;
  const outputPath = "/tmp/converted_audio.mp3";
  fs.writeFileSync(audioPath, audioContent);

  try {
    const cmd = `/opt/ffmpeglib/ffmpeg -i ${audioPath} -acodec libmp3lame ${outputPath}`;
    return new Promise((resolve, reject) => {
      exec(cmd, (error) => {
        if (error) {
          console.error("Error al convertir el audio:", error);
          reject(error);
        } else {
          const convertedAudio = fs.readFileSync(outputPath);

          const convertedBase64 = convertedAudio.toString("base64");

          fs.unlinkSync(audioPath);
          fs.unlinkSync(outputPath);

          resolve(Buffer.from(convertedBase64, "base64"));
        }
      });
    });
  } catch (error) {
    console.error("Error en la conversión del audio:", error);
    return null;
  }
};

export async function main(event: APIGatewayProxyEvent) {
  const s3 = new S3();

  let audioContent = Buffer.from(event.body as any, "base64");

  // const convertedAudio = await convertAudio(audioContent);
  const filename = event.pathParameters?.filename!;
  const splitedFilename =
    filename.split("-separator-")[filename.split("-separator-").length - 1];
  const fileFormat =
    splitedFilename.split(".")[splitedFilename.split(".").length - 1];

  if (fileFormat !== "mp3") {
    const mp3Audio = await convertAudio(audioContent, fileFormat);
    if (mp3Audio) audioContent = mp3Audio;
  }

  try {
    const filename = event.pathParameters?.filename!;

    const uploadParams = {
      Bucket: process.env.BUCKET_NAME || "",
      Key: replaceFilename(filename),
      Body: audioContent,
      ContentType: "audio/mpeg",
    };

    console.log("Uploading to ", process.env.BUCKET_NAME);

    const uploadResult = await s3.upload(uploadParams).promise();

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Audio uploaded successfully",
        location: uploadResult.Location,
      }),
    };
  } catch (error) {
    console.error("Error uploading audio:", error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Error uploading audio",
        error,
      }),
    };
  }
}
