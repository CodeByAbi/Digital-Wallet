import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  // No HTTP server — this process only consumes the transfer queue.
  await NestFactory.createApplicationContext(WorkerModule);
}
void bootstrap();
