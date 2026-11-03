-- 008_enrich_academic_topics.sql
-- Enrich academic topics for Computer Science curriculum (9 topics per subject)

-- 1. Ensure subjects exist so foreign key constraint is always satisfied
INSERT INTO subjects (id, code, name, description, semester, department, color, is_active, created_at, updated_at)
VALUES
  ('subj-dsa', 'CS-201', 'Data Structures & Algorithms', 'Foundational abstract data types, linear structures, trees and graphs.', 'Semester 3', 'Computer Science', '#4f46e5', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('subj-os', 'CS-301', 'Operating Systems & Virtual Memory', 'Kernel design, memory virtualization, paging, and process scheduling.', 'Semester 5', 'Computer Science', '#06b6d4', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('subj-net', 'CS-401', 'Computer Networks & Protocols', 'TCP/IP architecture, socket protocols, sliding windows, and congestion.', 'Semester 5', 'Computer Systems & Networks', '#10b981', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('subj-ai', 'CS-501', 'Artificial Intelligence & Machine Learning', 'Search heuristics, neural representations, and natural language models.', 'Semester 7', 'Artificial Intelligence', '#8b5cf6', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;

-- 2. Insert or update 36 comprehensive syllabus topics
INSERT INTO topics (id, subject_id, name, description, order_index, is_active, created_at, updated_at)
VALUES
  -- Data Structures & Algorithms (subj-dsa)
  ('top-dsa-1', 'subj-dsa', 'Stack Basics & LIFO Architecture', 'LIFO protocol, stack pointer, and memory layout.', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-dsa-2', 'subj-dsa', 'Push & Pop Pointer Operations & Boundary Guards', 'Constant-time O(1) insertion, retrieval, and boundary guards.', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-dsa-3', 'subj-dsa', 'Queue Mechanics & Circular Buffer Implementations', 'Dual-pointer enqueue and dequeue implementations, circular array buffers.', 3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-dsa-4', 'subj-dsa', 'Binary Search Trees & Recursive Traversals', 'In-order, pre-order, and post-order tree visitations, BST search property.', 4, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-dsa-5', 'subj-dsa', 'Hash Tables, Open Addressing & Collision Resolution', 'Hash functions, separate chaining, linear probing, and load factor thresholding.', 5, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-dsa-6', 'subj-dsa', 'Graph Representations: Adjacency Matrix & Lists', 'Directed vs undirected graphs, edge weights, space-time tradeoffs.', 6, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-dsa-7', 'subj-dsa', 'Graph Traversals: Breadth-First & Depth-First Search', 'Queue-driven BFS, recursion/stack DFS, cycle detection and connectivity.', 7, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-dsa-8', 'subj-dsa', 'Dynamic Programming: Memoization & Tabulation', 'Optimal substructure, overlapping subproblems, 0/1 Knapsack, LCS.', 8, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-dsa-9', 'subj-dsa', 'Heaps, Priority Queues & Heap Sort', 'Max/min-heap invariant, swim/sink heapify operations, O(N log N) sorting.', 9, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

  -- Operating Systems & Virtual Memory (subj-os)
  ('top-os-1', 'subj-os', 'Virtual Memory Abstraction & Memory Hierarchies', 'Contiguous virtual address space mapped dynamically onto physical RAM.', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-os-2', 'subj-os', 'Paging, Page Tables & Physical Frame Allocation', 'Virtual page numbers, frame tables, multilevel page tables, offset preservation.', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-os-3', 'subj-os', 'Page Fault Traps, Demand Paging & Disk Swapping', 'Hardware trap triggers, swap space I/O, page eviction policies (FIFO, LRU).', 3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-os-4', 'subj-os', 'TLB Hardware Caching & Translation Lookaside Architecture', 'Hardware associative cache accelerating page translation, hit rates, flushes.', 4, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-os-5', 'subj-os', 'Process Lifecycle, PCB & Context Switching', 'Process states, Process Control Block registers, kernel mode switches.', 5, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-os-6', 'subj-os', 'CPU Scheduling Algorithms: FCFS, Round Robin & Multi-Level Feedback', 'Preemptive vs non-preemptive scheduling, turnaround time, quantum sizing.', 6, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-os-7', 'subj-os', 'Inter-Process Communication & Synchronization Primitives', 'Shared memory, message queues, mutexes, semaphores, race conditions.', 7, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-os-8', 'subj-os', 'Deadlock Prevention, Detection & Bankers Algorithm', 'Mutual exclusion, hold and wait, no preemption, circular wait, safe states.', 8, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-os-9', 'subj-os', 'Virtual File Systems, Inodes & Disk Scheduling', 'File control blocks, inode allocation, directory structures, SCAN/LOOK algorithms.', 9, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

  -- Computer Networks & Protocols (subj-net)
  ('top-net-1', 'subj-net', 'OSI & TCP/IP Layered Reference Models', 'Layer boundaries, encapsulation, protocols, and data link frame abstraction.', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-net-2', 'subj-net', 'TCP 3-Way Handshake State Machine & ISN Negotiation', 'SYN, SYN-ACK, ACK connection setup, Initial Sequence Numbers, teardown.', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-net-3', 'subj-net', 'Sliding Window Flow Control & Buffer Management', 'Advertised receiver window (rwnd) preventing receiver buffer overflow.', 3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-net-4', 'subj-net', 'TCP Congestion Control: AIMD, Slow Start & Fast Recovery', 'Congestion window (cwnd), ssthresh, Reno vs Cubic, duplicate ACKs.', 4, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-net-5', 'subj-net', 'IP Addressing, CIDR Subnetting & Supernetting', 'IPv4/IPv6 headers, subnet masks, slash notation, network vs host IDs.', 5, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-net-6', 'subj-net', 'Routing Protocols: Distance Vector vs Link State', 'Bellman-Ford vs Dijkstra, RIP, OSPF link state advertisements, BGP peering.', 6, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-net-7', 'subj-net', 'Domain Name System (DNS) & Hierarchy Resolution', 'Root nameservers, TLD, authoritative DNS, caching, recursive lookups.', 7, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-net-8', 'subj-net', 'Transport Layer Security (TLS/HTTPS) & Cryptographic Handshakes', 'Cipher suites, asymmetric public key exchange, symmetric session encryption.', 8, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-net-9', 'subj-net', 'Application Layer Protocols: HTTP/1.1, HTTP/2, WebSocket & QUIC', 'Multiplexing, header compression, persistent bidirectional sockets, UDP-based QUIC.', 9, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

  -- Artificial Intelligence & Machine Learning (subj-ai)
  ('top-ai-1', 'subj-ai', 'Heuristic Search, State Space & A* Pathfinding', 'Admissible and consistent heuristics, open/closed lists, graph exploration.', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-ai-2', 'subj-ai', 'Supervised Learning: Linear & Logistic Regression', 'Hypothesis functions, mean squared error, cross-entropy, decision boundaries.', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-ai-3', 'subj-ai', 'Deep Neural Networks, Activation Functions & Backpropagation', 'Multilayer perceptrons, ReLU, Sigmoid, chain rule gradient propagation.', 3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-ai-4', 'subj-ai', 'Loss Functions, Optimization Algorithms & Stochastic Gradient Descent', 'Mini-batch SGD, momentum, RMSprop, Adam optimizer, learning rate schedules.', 4, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-ai-5', 'subj-ai', 'Convolutional Neural Networks (CNNs) & Computer Vision', 'Kernel filters, feature maps, stride, padding, pooling layers, ResNet skip connections.', 5, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-ai-6', 'subj-ai', 'Recurrent Neural Networks, LSTMs & Sequence Modeling', 'Hidden state feedback, vanishing gradients, forget gates, cell state highway.', 6, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-ai-7', 'subj-ai', 'Self-Attention Mechanics, Encoders & Transformer Architectures', 'Query-Key-Value dot-product scaling, multi-head attention, positional encoding.', 7, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-ai-8', 'subj-ai', 'Large Language Models, Context Windows & Prompt Engineering', 'Causal masking, auto-regressive decoding, temperature, Top-P, token embeddings.', 8, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('top-ai-9', 'subj-ai', 'Reinforcement Learning: Markov Decision Processes & Q-Learning', 'Agent-environment loop, Bellman optimality equation, exploration vs exploitation.', 9, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  order_index = EXCLUDED.order_index,
  is_active = EXCLUDED.is_active,
  updated_at = CURRENT_TIMESTAMP;
