CREATE KEYSPACE IF NOT EXISTS encurtador
WITH replication = {'class':'NetworkTopologyStrategy','datacenter1':1}
AND durable_writes = true;
