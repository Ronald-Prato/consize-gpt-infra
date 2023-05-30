import { Duration } from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";

import { OPENAI_API_KEY } from "../env";
import { StackContext, Bucket, Queue, ApiGatewayV1Api } from "sst/constructs";

export function MainStack({ stack }: StackContext) {
  const myQueue = new Queue(stack, "generate-summary-queue", {
    cdk: {
      queue: {
        visibilityTimeout: Duration.seconds(180 * 6),
      },
    },
  });

  const myBucket = new Bucket(stack, "temporal-audios-bucket", {
    notifications: {
      myNotification: {
        type: "queue",
        queue: myQueue,
        events: ["object_created_put"],
      },
    },
  });

  const api = new ApiGatewayV1Api(stack, "consize-gpt-api", {
    customDomain: "api.consizegpt.com",
    cdk: {
      restApi: {
        defaultCorsPreflightOptions: {
          allowOrigins: ['"*"'],
        },
        binaryMediaTypes: ["*/*"],
      },
    },
    routes: {
      "GET /": {
        function: {
          handler: "packages/functions/healthCheck.main",
          timeout: 60,
        },
      },
      "POST /create-user": {
        function: {
          handler: "packages/functions/createUser.main",
          timeout: 60,
        },
      },
      "POST /upload-audio/{filename}": {
        function: {
          handler: "packages/functions/uploadAudio.main",
          timeout: 180,
          environment: { BUCKET_NAME: myBucket.bucketName },
          layers: [
            new lambda.LayerVersion(stack, "ffmpeg-layer", {
              code: lambda.Code.fromAsset("layers/ffmpeg.zip"),
            }),
          ],
        },
      },
    },
  });

  api.attachPermissionsToRoute("POST /upload-audio/{filename}", ["s3"]);

  myQueue.addConsumer(stack, {
    function: {
      handler: "packages/functions/generateSummary.main",
      timeout: 300,
      environment: { BUCKET_NAME: myBucket.bucketName, OPENAI_API_KEY },
      permissions: [myBucket],
    },
  });

  // Show the endpoint in the output
  stack.addOutputs({
    ApiEndpoint: api.url,
    CustomEndpoint: api.customDomainUrl,
    BucketName: myBucket.bucketName,
    BucketArn: myBucket.bucketArn,
    QueueName: myQueue.queueName,
    QueueUrl: myQueue.queueUrl,
  });
}
