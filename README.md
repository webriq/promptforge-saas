# PromptForge SaaS

An AI-powered content generation platform that combines **RAG (Retrieval-Augmented Generation)** technology with **vector-based knowledge management** to create high-quality, contextually-aware content.

## 🎯 What is PromptForge SaaS?

PromptForge SaaS is a complete content generation platform that helps users create professional, well-structured content by leveraging:

- **Your own knowledge base** - Upload documents (PDF, TXT) that become the foundation for content generation
- **AI-powered writing** - Advanced language models that understand context and generate relevant content
- **Smart search** - Vector-based similarity search to find the most relevant information
- **Version control** - Track, compare, and manage different versions of your generated content
- **Multi-project support** - Organize content across different projects and teams

## ✨ Key Features

### 🧠 Intelligent Content Generation

- **Context-aware responses** using your uploaded documents
- **Multi-format support** for PDF and text file ingestion
- **Automatic content chunking** for optimal AI processing
- **Real-time streaming** responses for better user experience

### 📚 Knowledge Management

- **Vector embeddings** for semantic search across your documents
- **Project-specific knowledge bases** with session isolation
- **Bulk content import** for processing multiple documents at once
- **Source attribution** to track where information comes from

### 🔄 Content Versioning

- **Version control** for all AI-generated content
- **Draft/published workflow** for content management
- **Author tracking** and collaboration features
- **Content comparison** between different versions

### 💬 Session Management

- **Persistent chat sessions** with contextual memory
- **Automatic title generation** based on conversation content
- **Message history** with role-based organization
- **Multi-project organization** for different use cases

## 🚀 How It Works

1. Upload Your Knowledge Base
2. Start a Chat Session
3. Generate Content
4. Manage Content Versions

## 🏗️ Technical Architecture

### Core Components

| Component           | Purpose                      | Technology                    |
| ------------------- | ---------------------------- | ----------------------------- |
| **Vector Database** | Semantic search & embeddings | PostgreSQL + pgvector         |
| **AI Engine**       | Content generation           | OpenAI GPT & Embeddings       |
| **Knowledge Base**  | Document storage & retrieval | Chunked content with metadata |
| **Session Manager** | Conversation state           | Persistent chat sessions      |
| **Version Control** | Content management           | Draft/published workflow      |

### API Endpoints

| Endpoint                | Purpose                 | Key Features                       |
| ----------------------- | ----------------------- | ---------------------------------- |
| `/chat-api`             | Main content generation | RAG integration, streaming         |
| `/upload-file-api`      | Document processing     | PDF/TXT parsing, chunking          |
| `/sessions-api`         | Session management      | CRUD operations, project filtering |
| `/content-versions-api` | Version management      | Publishing workflow                |
| `/bulk-knowledge-api`   | Bulk operations         | Batch processing                   |

### Data Flow

1. **Document Upload** → Content is chunked and converted to vector embeddings
2. **User Query** → System searches for relevant content using vector similarity
3. **Context Building** → Retrieved content is combined with chat history
4. **AI Generation** → OpenAI generates contextually-aware responses
5. **Version Control** → Generated content is saved with versioning

## 🎨 Use Cases

### Content Creation

- **Blog posts** based on research documents
- **Technical documentation** from existing knowledge
- **Marketing copy** using brand guidelines
- **Reports** synthesized from multiple sources

### Knowledge Management

- **Document Q&A** across large document collections
- **Research synthesis** from academic papers
- **Policy explanations** from legal documents
- **Training materials** from existing content

### Collaborative Writing

- **Team content creation** with shared knowledge bases
- **Version tracking** for editorial workflows
- **Multi-project organization** for different clients
- **Source attribution** for compliance

## 📊 Performance & Scale

### Vector Search Performance

- **IVFFlat indexing** for sub-second similarity search
- **Configurable similarity thresholds** for precision control
- **Batch embedding generation** for efficiency
- **Horizontal scaling** ready architecture

### Content Generation

- **Streaming responses** for real-time user experience
- **Context-aware generation** using retrieved documents
- **Multi-format output** (Markdown, HTML, plain text)
- **Customizable prompts** for different content types

## 🔧 Setup & Deployment

### Quick Start (Local Development)

```bash
# Clone and setup
git clone <repository-url>
cd promptforge-saas

# Start local Supabase
supabase start
supabase db reset

# Deploy functions
supabase functions serve --no-verify-jwt
```

## 📚 Documentation

- **[API Documentation](docs/api.md)** - Endpoint details and examples
- **[Troubleshooting](docs/troubleshooting.md)** - Common issues and solutions

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **GitHub Issues** for bug reports and feature requests
- **Documentation** for setup and usage questions
- **Community** for general discussions and help
