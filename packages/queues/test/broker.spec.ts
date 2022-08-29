import {
  MAX_ATTEMPTS,
  QueueBroker,
  kSetFlushCallback,
} from "@miniflare/queues";
import { MessageBatch, Consumer, kSetConsumer } from "@miniflare/shared";
import test from "ava";

test("QueueBroker: flushes partial batches", async (t) => {
  const broker = new QueueBroker();
  const q = broker.getOrCreateQueue("myQueue");
  const sub: Consumer = {
    queueName: "myQueue",
    maxBatchSize: 5,
    maxWaitMs: 1,
    dispatcher: async (_batch) => {},
  };
  q[kSetConsumer](sub);

  sub.dispatcher = async (batch: MessageBatch) => {
    t.deepEqual(batch.queue, "myQueue");

    t.deepEqual(
      batch.messages.map((x) => {
        return { id: x.id, body: x.body };
      }),
      [{ id: "myQueue-0", body: "message1" }]
    );
  };
  q.send("message1");
  let prom = new Promise<void>((resolve) => {
    q[kSetFlushCallback](() => resolve());
  });
  await prom;

  sub.dispatcher = async (batch: MessageBatch) => {
    t.deepEqual(
      batch.messages.map((x) => {
        return { id: x.id, body: x.body };
      }),
      [
        { id: "myQueue-1", body: "message2" },
        { id: "myQueue-2", body: "message3" },
      ]
    );
  };
  q.send("message2");
  q.send("message3");

  prom = new Promise<void>((resolve) => {
    q[kSetFlushCallback](() => resolve());
  });
  await prom;

  sub.dispatcher = async (batch: MessageBatch) => {
    t.deepEqual(
      batch.messages.map((x) => {
        return { id: x.id, body: x.body };
      }),
      [
        { id: "myQueue-3", body: "message4" },
        { id: "myQueue-4", body: "message5" },
        { id: "myQueue-5", body: "message6" },
      ]
    );
  };
  q.send("message4");
  q.send("message5");
  q.send("message6");
  prom = new Promise<void>((resolve) => {
    q[kSetFlushCallback](() => resolve());
  });
  await prom;

  sub.dispatcher = async (batch: MessageBatch) => {
    t.deepEqual(
      batch.messages.map((x) => {
        return { id: x.id, body: x.body };
      }),
      [
        { id: "myQueue-6", body: "message7" },
        { id: "myQueue-7", body: "message8" },
        { id: "myQueue-8", body: "message9" },
      ]
    );
  };

  q.sendBatch([
    { body: "message7" },
    { body: "message8" },
    { body: "message9" },
  ]);
  prom = new Promise<void>((resolve) => {
    q[kSetFlushCallback](() => resolve());
  });
  await prom;
});

test("QueueBroker: flushes full batches", async (t) => {
  const broker = new QueueBroker();
  const q = broker.getOrCreateQueue("myQueue");
  const sub: Consumer = {
    queueName: "myQueue",
    maxBatchSize: 5,
    maxWaitMs: 1,
    dispatcher: async (_batch) => {},
  };
  q[kSetConsumer](sub);
  sub.dispatcher = async (batch: MessageBatch) => {
    t.deepEqual(
      batch.messages.map((x) => x.body),
      ["message1", "message2", "message3", "message4", "message5"]
    );
  };

  q.send("message1");
  q.send("message2");
  q.send("message3");
  q.send("message4");
  q.send("message5");
  let prom = new Promise<void>((resolve) => {
    q[kSetFlushCallback](() => resolve());
  });
  await prom;

  sub.dispatcher = async (batch: MessageBatch) => {
    t.deepEqual(
      batch.messages.map((x) => x.body),
      [
        "message6",
        "message7",
        "message8",
        "message9",
        "message10",
        "message11",
        "message12",
      ]
    );
  };

  q.send("message6");
  q.send("message7");
  q.send("message8");
  q.send("message9");
  q.send("message10");
  q.send("message11");
  q.send("message12");
  prom = new Promise<void>((resolve) => {
    q[kSetFlushCallback](() => resolve());
  });
  await prom;

  sub.dispatcher = async (batch: MessageBatch) => {
    t.deepEqual(
      batch.messages.map((x) => x.body),
      [
        "message13",
        "message14",
        "message15",
        "message16",
        "message17",
        "message18",
        "message19",
      ]
    );
  };

  q.sendBatch([
    { body: "message13" },
    { body: "message14" },
    { body: "message15" },
    { body: "message16" },
    { body: "message17" },
    { body: "message18" },
    { body: "message19" },
  ]);
  prom = new Promise<void>((resolve) => {
    q[kSetFlushCallback](() => resolve());
  });
  await prom;
});

test("QueueBroker: supports message retry()", async (t) => {
  const broker = new QueueBroker();
  const q = broker.getOrCreateQueue("myQueue");
  const sub: Consumer = {
    queueName: "myQueue",
    maxBatchSize: 5,
    maxWaitMs: 1,
    dispatcher: async (_batch) => {},
  };
  q[kSetConsumer](sub);

  let retries = 0;
  sub.dispatcher = async (batch: MessageBatch) => {
    if (retries == 0) {
      batch.messages[0].retry();
      retries++;

      // Send another message from within the dispatcher
      // to ensure it doesn't get dropped
      q.send("message2");
      return;
    }

    // The second time around both messages should be present
    t.deepEqual(batch.messages.length, 2);
    t.deepEqual(batch.messages[0].body, "message2");
    t.deepEqual(batch.messages[1].body, "message1");
  };

  // Expect the queue to flush() twice (one retry)
  q.send("message1");
  let prom = new Promise<void>((resolve) => {
    q[kSetFlushCallback](() => resolve());
  });
  await prom;
  t.deepEqual(retries, 1);

  prom = new Promise<void>((resolve) => {
    q[kSetFlushCallback](() => resolve());
  });
  await prom;
  t.deepEqual(retries, 1);
});

test("QueueBroker: automatic retryAll() on consumer error", async (t) => {
  const broker = new QueueBroker();
  const q = broker.getOrCreateQueue("myQueue");
  const sub: Consumer = {
    queueName: "myQueue",
    maxBatchSize: 5,
    maxWaitMs: 1,
    dispatcher: async (_batch) => {},
  };
  q[kSetConsumer](sub);

  let retries = 0;
  sub.dispatcher = async (batch: MessageBatch) => {
    if (retries == 0) {
      // Send another message from within the dispatcher
      // to ensure it doesn't get dropped
      q.send("message3");
      retries++;

      throw new Error("fake consumer error");
    }

    // The second time around 3 messages should be present
    t.deepEqual(batch.messages.length, 3);
    t.deepEqual(batch.messages[0].body, "message3");
    t.deepEqual(batch.messages[1].body, "message1");
    t.deepEqual(batch.messages[2].body, "message2");
  };

  // Expect the queue to flush() twice (one retry)
  q.send("message1");
  q.send("message2");

  let prom = new Promise<void>((resolve) => {
    q[kSetFlushCallback](() => resolve());
  });
  await prom;
  t.deepEqual(retries, 1);

  prom = new Promise<void>((resolve) => {
    q[kSetFlushCallback](() => resolve());
  });
  await prom;
  t.deepEqual(retries, 1);
});

test("QueueBroker: drops messages after max retry()", async (t) => {
  const broker = new QueueBroker();
  const q = broker.getOrCreateQueue("myQueue");
  const sub: Consumer = {
    queueName: "myQueue",
    maxBatchSize: 5,
    maxWaitMs: 1,
    dispatcher: async (_batch) => {},
  };
  q[kSetConsumer](sub);

  let retries = 0;
  sub.dispatcher = async (batch: MessageBatch) => {
    batch.messages[0].retry();
    retries++;
  };

  // Expect the queue to flush() the maximum number of times
  q.send("message1");

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const prom = new Promise<void>((resolve) => {
      q[kSetFlushCallback](() => resolve());
    });
    await prom;
    t.deepEqual(retries, i + 1);
  }

  // To check that "message1" is dropped:
  // send another message "message2" and ensure it is the only one in the new batch
  sub.dispatcher = async (batch: MessageBatch) => {
    t.deepEqual(batch.messages.length, 1);
    t.deepEqual(batch.messages[0].body, "message2");
  };
  q.send("message2");
  const prom = new Promise<void>((resolve) => {
    q[kSetFlushCallback](() => resolve());
  });
  await prom;
});
