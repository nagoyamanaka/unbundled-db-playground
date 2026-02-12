-- 投稿テーブル
CREATE TABLE posts (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    author VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- サンプルデータ
INSERT INTO posts (title, content, author) VALUES
    ('Welcome to Unbundled DB', 'This is a demonstration of the unbundled database architecture from DDIA Chapter 12.', 'Admin'),
    ('Understanding Event Sourcing', 'Event sourcing is a powerful pattern for building distributed systems.', 'Alice'),
    ('Kafka vs RabbitMQ', 'Comparing different message brokers for event-driven architectures.', 'Bob');

-- インデックス
CREATE INDEX idx_posts_author ON posts(author);
CREATE INDEX idx_posts_created_at ON posts(created_at DESC);