/**
 * AWS architecture service and boundary catalog.
 *
 * Static catalog data for AWS services and nested boundaries, with stable IDs,
 * official names, descriptions, search aliases, and local icon asset references.
 * Catalog entries supply picker metadata, validation context, and agent knowledge.
 */

export interface AwsCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly aliases: readonly string[];
  readonly category: string;
  readonly kind: "service" | "boundary";
  readonly iconPath: string;
  readonly defaultSize: { readonly width: number; readonly height: number };
}

const serviceSize = { width: 180, height: 100 };
const boundarySize = { width: 400, height: 240 };

export const AWS_CATALOG: readonly AwsCatalogEntry[] = [
  // Compute and containers
  {
    id: "aws-ec2",
    name: "Amazon EC2",
    description: "Runs virtual machines with flexible compute capacity.",
    aliases: ["ec2", "compute", "instance"],
    category: "Compute and containers",
    kind: "service",
    iconPath: "/aws-icons/aws-ec2.svg",
    defaultSize: serviceSize,
  },
  {
    id: "aws-lambda",
    name: "AWS Lambda",
    description: "Runs serverless functions without managing servers.",
    aliases: ["lambda", "serverless", "function"],
    category: "Compute and containers",
    kind: "service",
    iconPath: "/aws-icons/aws-lambda.svg",
    defaultSize: serviceSize,
  },
  {
    id: "aws-ecs",
    name: "Amazon ECS",
    description: "Orchestrates Docker containers with managed control plane.",
    aliases: ["ecs", "container", "docker"],
    category: "Compute and containers",
    kind: "service",
    iconPath: "/aws-icons/aws-ecs.svg",
    defaultSize: serviceSize,
  },
  {
    id: "aws-eks",
    name: "Amazon EKS",
    description: "Managed Kubernetes service for running containerized applications.",
    aliases: ["eks", "kubernetes", "container"],
    category: "Compute and containers",
    kind: "service",
    iconPath: "/aws-icons/aws-eks.svg",
    defaultSize: serviceSize,
  },
  {
    id: "aws-fargate",
    name: "AWS Fargate",
    description: "Runs containers without managing EC2 instances.",
    aliases: ["fargate", "container", "serverless"],
    category: "Compute and containers",
    kind: "service",
    iconPath: "/aws-icons/aws-fargate.svg",
    defaultSize: serviceSize,
  },
  {
    id: "aws-ecr",
    name: "Amazon ECR",
    description: "Stores and manages Docker container images.",
    aliases: ["ecr", "registry", "container", "image"],
    category: "Compute and containers",
    kind: "service",
    iconPath: "/aws-icons/aws-ecr.svg",
    defaultSize: serviceSize,
  },
  // Networking
  {
    id: "aws-vpc",
    name: "Amazon VPC",
    description: "Virtual network for AWS resources with custom IP ranges.",
    aliases: ["vpc", "network", "virtual"],
    category: "Networking",
    kind: "service",
    iconPath: "/aws-icons/aws-vpc.svg",
    defaultSize: serviceSize,
  },
  {
    id: "aws-route-53",
    name: "Amazon Route 53",
    description: "DNS service for domain registration and routing.",
    aliases: ["route 53", "dns", "domain"],
    category: "Networking",
    kind: "service",
    iconPath: "/aws-icons/aws-route-53.svg",
    defaultSize: serviceSize,
  },
  {
    id: "aws-cloudfront",
    name: "Amazon CloudFront",
    description: "Content delivery network for fast, secure content distribution.",
    aliases: ["cloudfront", "cdn", "content delivery"],
    category: "Networking",
    kind: "service",
    iconPath: "/aws-icons/aws-cloudfront.svg",
    defaultSize: serviceSize,
  },
  {
    id: "aws-elb",
    name: "Elastic Load Balancing",
    description: "Distributes incoming traffic across resources.",
    aliases: ["elb", "alb", "nlb", "load balancer", "routing"],
    category: "Networking",
    kind: "service",
    iconPath: "/aws-icons/aws-elb.svg",
    defaultSize: serviceSize,
  },
  {
    id: "aws-api-gateway",
    name: "Amazon API Gateway",
    description: "Creates and manages APIs for applications.",
    aliases: ["api gateway", "api", "endpoint"],
    category: "Networking",
    kind: "service",
    iconPath: "/aws-icons/aws-api-gateway.svg",
    defaultSize: serviceSize,
  },
  // Storage and databases
  {
    id: "aws-s3",
    name: "Amazon S3",
    description: "Stores objects such as uploads, backups and static assets.",
    aliases: ["s3", "object storage", "bucket"],
    category: "Storage and databases",
    kind: "service",
    iconPath: "/aws-icons/aws-s3.svg",
    defaultSize: serviceSize,
  },
  {
    id: "aws-ebs",
    name: "Amazon EBS",
    description: "Block storage volumes for EC2 instances.",
    aliases: ["ebs", "storage", "volume"],
    category: "Storage and databases",
    kind: "service",
    iconPath: "/aws-icons/aws-ebs.svg",
    defaultSize: serviceSize,
  },
  {
    id: "aws-efs",
    name: "Amazon EFS",
    description: "Elastic file system for EC2 instances.",
    aliases: ["efs", "file storage", "nfs"],
    category: "Storage and databases",
    kind: "service",
    iconPath: "/aws-icons/aws-efs.svg",
    defaultSize: serviceSize,
  },
  {
    id: "aws-rds",
    name: "Amazon RDS",
    description: "Managed relational database service.",
    aliases: ["rds", "database", "sql"],
    category: "Storage and databases",
    kind: "service",
    iconPath: "/aws-icons/aws-rds.svg",
    defaultSize: serviceSize,
  },
  {
    id: "aws-aurora",
    name: "Amazon Aurora",
    description: "High-performance managed relational database compatible with MySQL and PostgreSQL.",
    aliases: ["aurora", "database", "sql"],
    category: "Storage and databases",
    kind: "service",
    iconPath: "/aws-icons/aws-aurora.svg",
    defaultSize: serviceSize,
  },
  {
    id: "aws-dynamodb",
    name: "Amazon DynamoDB",
    description: "NoSQL database for real-time applications.",
    aliases: ["dynamodb", "nosql", "database"],
    category: "Storage and databases",
    kind: "service",
    iconPath: "/aws-icons/aws-dynamodb.svg",
    defaultSize: serviceSize,
  },
  {
    id: "aws-elasticache",
    name: "Amazon ElastiCache",
    description: "In-memory caching service for high performance.",
    aliases: ["elasticache", "cache", "redis", "memcached"],
    category: "Storage and databases",
    kind: "service",
    iconPath: "/aws-icons/aws-elasticache.svg",
    defaultSize: serviceSize,
  },
  // Messaging and workflows
  {
    id: "aws-sqs",
    name: "Amazon SQS",
    description: "Queues messages between decoupled application components.",
    aliases: ["sqs", "queue", "messaging"],
    category: "Messaging and workflows",
    kind: "service",
    iconPath: "/aws-icons/aws-sqs.svg",
    defaultSize: serviceSize,
  },
  {
    id: "aws-sns",
    name: "Amazon SNS",
    description: "Publishes messages to subscribers.",
    aliases: ["sns", "publish", "notification"],
    category: "Messaging and workflows",
    kind: "service",
    iconPath: "/aws-icons/aws-sns.svg",
    defaultSize: serviceSize,
  },
  {
    id: "aws-eventbridge",
    name: "Amazon EventBridge",
    description: "Routes events from applications, AWS services, and partners.",
    aliases: ["eventbridge", "event", "routing"],
    category: "Messaging and workflows",
    kind: "service",
    iconPath: "/aws-icons/aws-eventbridge.svg",
    defaultSize: serviceSize,
  },
  {
    id: "aws-step-functions",
    name: "AWS Step Functions",
    description: "Orchestrates workflows using visual state machines.",
    aliases: ["step functions", "workflow", "orchestration"],
    category: "Messaging and workflows",
    kind: "service",
    iconPath: "/aws-icons/aws-step-functions.svg",
    defaultSize: serviceSize,
  },
  // Security and monitoring
  {
    id: "aws-iam",
    name: "AWS IAM",
    description: "Manages users, roles, and permissions for AWS resources.",
    aliases: ["iam", "identity", "access", "permissions"],
    category: "Security and monitoring",
    kind: "service",
    iconPath: "/aws-icons/aws-iam.svg",
    defaultSize: serviceSize,
  },
  {
    id: "aws-cloudwatch",
    name: "Amazon CloudWatch",
    description: "Monitors metrics, logs, and events from AWS resources.",
    aliases: ["cloudwatch", "monitoring", "logs", "metrics"],
    category: "Security and monitoring",
    kind: "service",
    iconPath: "/aws-icons/aws-cloudwatch.svg",
    defaultSize: serviceSize,
  },
  // Boundaries
  {
    id: "boundary-aws-cloud",
    name: "AWS Cloud",
    description: "Represents the AWS cloud environment.",
    aliases: ["cloud", "aws"],
    category: "Boundaries",
    kind: "boundary",
    iconPath: "/aws-icons/boundary-aws-cloud.svg",
    defaultSize: boundarySize,
  },
  {
    id: "boundary-region",
    name: "Region",
    description: "AWS geographic region containing multiple availability zones.",
    aliases: ["region", "geographic"],
    category: "Boundaries",
    kind: "boundary",
    iconPath: "/aws-icons/boundary-region.svg",
    defaultSize: boundarySize,
  },
  {
    id: "boundary-availability-zone",
    name: "Availability Zone",
    description: "Isolated location within a region with its own power and cooling.",
    aliases: ["availability zone", "az", "zone"],
    category: "Boundaries",
    kind: "boundary",
    iconPath: "/aws-icons/boundary-availability-zone.svg",
    defaultSize: boundarySize,
  },
  {
    id: "boundary-vpc",
    name: "VPC",
    description: "Virtual private cloud for isolating your network.",
    aliases: ["vpc", "network", "virtual"],
    category: "Boundaries",
    kind: "boundary",
    iconPath: "/aws-icons/boundary-vpc.svg",
    defaultSize: boundarySize,
  },
  {
    id: "boundary-subnet",
    name: "Subnet",
    description: "Segment of a VPC with its own IP address range.",
    aliases: ["subnet", "network"],
    category: "Boundaries",
    kind: "boundary",
    iconPath: "/aws-icons/boundary-subnet.svg",
    defaultSize: boundarySize,
  },
  {
    id: "boundary-eks-cluster",
    name: "EKS Cluster",
    description: "Kubernetes cluster managed by Amazon EKS.",
    aliases: ["eks cluster", "kubernetes", "container"],
    category: "Boundaries",
    kind: "boundary",
    iconPath: "/aws-icons/boundary-eks-cluster.svg",
    defaultSize: boundarySize,
  },
];

/**
 * Looks up a catalog entry by its stable ID.
 * Returns undefined if the ID is not found.
 */
export function getAwsCatalogEntry(id: string): AwsCatalogEntry | undefined {
  return AWS_CATALOG.find((entry) => entry.id === id);
}

/**
 * Searches the catalog for entries matching a query string.
 * Searches are case-insensitive and match against name and aliases.
 * Returns an empty array if no matches are found.
 */
export function searchAwsCatalog(query: string): readonly AwsCatalogEntry[] {
  const term = query.trim().toLowerCase();
  if (term.length === 0) {
    return AWS_CATALOG;
  }
  return AWS_CATALOG.filter((entry) =>
    [entry.name, ...entry.aliases].some((value) =>
      value.toLowerCase().includes(term),
    ),
  );
}
